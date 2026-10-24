import json
import shlex
import subprocess
import threading
from pathlib import Path

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class UsbPrinterNode(Node):
    def __init__(self):
        super().__init__("usb_printer_node")
        self.declare_parameter("backend", "cups")
        self.declare_parameter("printer_name", "")
        self.declare_parameter("print_command", "lp")
        self.declare_parameter("usb_device", "/dev/usb/lp0")
        self.declare_parameter("job_topic", "/print_robot/jobs/request")
        self.declare_parameter("manual_print_topic", "/print_robot/printer/request")
        self.declare_parameter("job_state_topic", "/print_robot/jobs/state")
        self.declare_parameter("printer_state_topic", "/print_robot/printer/state")
        self.declare_parameter("auto_print_modes", "mobile_print")
        self.declare_parameter("command_timeout_sec", 180)

        self.backend = str(self.get_parameter("backend").value)
        self.printer_name = str(self.get_parameter("printer_name").value).strip()
        self.print_command = str(self.get_parameter("print_command").value).strip() or "lp"
        self.usb_device = str(self.get_parameter("usb_device").value).strip() or "/dev/usb/lp0"
        self.auto_print_modes = {
            item.strip()
            for item in str(self.get_parameter("auto_print_modes").value).split(",")
            if item.strip()
        }
        self.command_timeout_sec = int(self.get_parameter("command_timeout_sec").value)

        self.active_job_ids = set()
        self.finished_job_ids = set()
        self.lock = threading.Lock()

        self.job_state_publisher = self.create_publisher(
            String,
            str(self.get_parameter("job_state_topic").value),
            10,
        )
        self.printer_state_publisher = self.create_publisher(
            String,
            str(self.get_parameter("printer_state_topic").value),
            10,
        )

        self.create_subscription(
            String,
            str(self.get_parameter("job_topic").value),
            self.on_job_request,
            10,
        )
        self.create_subscription(
            String,
            str(self.get_parameter("manual_print_topic").value),
            self.on_manual_print_request,
            10,
        )

        self.get_logger().info(
            f"USB printer node ready: backend={self.backend}, printer={self.printer_name or 'default'}, "
            f"auto_print_modes={','.join(sorted(self.auto_print_modes)) or 'none'}"
        )

    def on_job_request(self, msg):
        payload = self.parse_payload(msg.data)
        if payload is None:
            return

        print_mode = payload.get("printSettings", {}).get("printMode", "mobile_print")
        if print_mode not in self.auto_print_modes:
            self.get_logger().info(
                f"Job {payload.get('id', '<unknown>')} printMode={print_mode}; waiting for manual print request"
            )
            return

        self.start_print_thread(payload, force=False, source="job_request")

    def on_manual_print_request(self, msg):
        payload = self.parse_payload(msg.data)
        if payload is None:
            return
        self.start_print_thread(payload, force=bool(payload.get("force", True)), source="manual_print")

    def parse_payload(self, data):
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            self.get_logger().warning("Ignoring print request because payload is not JSON")
            return None

        if isinstance(payload.get("job"), dict):
            payload = payload["job"]

        if not payload.get("id"):
            payload["id"] = "JOB-UNKNOWN"
        return payload

    def start_print_thread(self, job, force=False, source="unknown"):
        job_id = str(job.get("id", "JOB-UNKNOWN"))
        with self.lock:
            if job_id in self.active_job_ids:
                self.get_logger().warning(f"Print job {job_id} is already active; ignoring duplicate request")
                return
            if job_id in self.finished_job_ids and not force:
                self.get_logger().warning(f"Print job {job_id} already finished; ignoring duplicate request")
                return
            self.active_job_ids.add(job_id)

        thread = threading.Thread(target=self.print_job, args=(job, source), daemon=True)
        thread.start()

    def print_job(self, job, source):
        job_id = str(job.get("id", "JOB-UNKNOWN"))
        try:
            self.publish_printer_state(job_id, "printing", f"Print started from {source}")
            self.publish_job_state(job_id, {"printerStatus": "printing", "printProgress": 5})

            file_path = Path(str(job.get("filePath", ""))).expanduser()
            if not file_path.exists() or not file_path.is_file():
                raise FileNotFoundError(f"filePath does not exist: {file_path}")

            settings = job.get("printSettings", {})
            if self.backend == "raw":
                result = self.print_raw_usb(file_path)
            else:
                result = self.print_with_cups(file_path, job_id, settings)

            self.publish_job_state(
                job_id,
                {
                    "printerStatus": "done",
                    "printProgress": 100,
                    "printBackend": self.backend,
                    "printResult": result,
                },
            )
            self.publish_printer_state(job_id, "done", result)
            self.get_logger().info(f"Print job {job_id} finished: {result}")
            with self.lock:
                self.finished_job_ids.add(job_id)
        except Exception as error:
            message = str(error)
            self.get_logger().error(f"Print job {job_id} failed: {message}")
            self.publish_job_state(
                job_id,
                {
                    "printerStatus": "error",
                    "printProgress": 0,
                    "error": message,
                },
            )
            self.publish_printer_state(job_id, "error", message)
        finally:
            with self.lock:
                self.active_job_ids.discard(job_id)

    def print_with_cups(self, file_path, job_id, settings):
        command = [self.print_command]
        if self.printer_name:
            command.extend(["-d", self.printer_name])

        copies = int(settings.get("copies") or 1)
        if copies > 1:
            command.extend(["-n", str(copies)])

        pages = str(settings.get("pages") or "").strip()
        if pages and pages not in ["全部", "all", "All", "ALL"]:
            command.extend(["-P", pages])

        paper_size = str(settings.get("paperSize") or "").strip()
        if paper_size:
            command.extend(["-o", f"media={paper_size}"])

        duplex = str(settings.get("duplex") or "single")
        if duplex == "duplex":
            command.extend(["-o", "sides=two-sided-long-edge"])
        else:
            command.extend(["-o", "sides=one-sided"])

        color_mode = str(settings.get("colorMode") or "mono")
        if color_mode == "color":
            command.extend(["-o", "print-color-mode=color"])
        else:
            command.extend(["-o", "print-color-mode=monochrome"])

        priority = str(settings.get("priority") or "normal")
        if priority == "high":
            command.extend(["-q", "80"])
        elif priority == "batch":
            command.extend(["-q", "30"])

        command.extend(["-t", job_id, str(file_path)])
        self.get_logger().info("Running print command: " + shlex.join(command))

        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=self.command_timeout_sec,
        )
        stdout = completed.stdout.strip()
        stderr = completed.stderr.strip()
        if completed.returncode != 0:
            raise RuntimeError(f"{shlex.join(command)} failed: {stderr or stdout}")
        return stdout or f"submitted to CUPS printer {self.printer_name or 'default'}"

    def print_raw_usb(self, file_path):
        device_path = Path(self.usb_device)
        if not device_path.exists():
            raise FileNotFoundError(f"USB printer device not found: {device_path}")

        with file_path.open("rb") as source, device_path.open("wb") as target:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
        return f"sent raw bytes to {device_path}"

    def publish_job_state(self, job_id, fields):
        payload = {"job": {"id": job_id, **fields}}
        self.publish_json(self.job_state_publisher, payload)

    def publish_printer_state(self, job_id, state, message):
        payload = {"jobId": job_id, "state": state, "message": message}
        self.publish_json(self.printer_state_publisher, payload)

    @staticmethod
    def publish_json(publisher, payload):
        msg = String()
        msg.data = json.dumps(payload, ensure_ascii=False)
        publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = UsbPrinterNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
