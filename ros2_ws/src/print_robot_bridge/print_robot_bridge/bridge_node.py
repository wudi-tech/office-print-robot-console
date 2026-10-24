import cgi
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    from ament_index_python.packages import get_package_share_directory
except ImportError:
    get_package_share_directory = None

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class PrintRobotBridge(Node):
    def __init__(self):
        super().__init__("print_robot_bridge")
        self.declare_parameter("host", "0.0.0.0")
        self.declare_parameter("port", 8080)
        self.declare_parameter("upload_dir", "/tmp/print_robot_uploads")
        self.declare_parameter("stations_config", "")

        self.host = self.get_parameter("host").value
        self.port = int(self.get_parameter("port").value)
        self.upload_dir = Path(str(self.get_parameter("upload_dir").value))
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.floor_config = self.load_floor_config()
        self.stations = {
            station["id"]: self.normalize_station(station)
            for station in self.floor_config.get("stations", [])
            if station.get("id")
        }
        self.home_station = self.find_station_by_type("dock")
        self.active_job_statuses = [
            "queued",
            "printing",
            "printing_en_route",
            "navigating_to_target",
            "delivering",
            "awaiting_manual_print",
        ]

        self.jobs = {}
        self.status = self.default_status()
        self.lock = threading.Lock()

        self.job_publisher = self.create_publisher(String, "/print_robot/jobs/request", 10)
        self.cancel_publisher = self.create_publisher(String, "/print_robot/jobs/cancel", 10)
        self.create_subscription(String, "/print_robot/status", self.on_status, 10)
        self.create_subscription(String, "/print_robot/jobs/state", self.on_job_state, 10)

        self.httpd = ThreadingHTTPServer((self.host, self.port), self.make_handler())
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.http_thread.start()
        self.get_logger().info(f"HTTP API listening on http://{self.host}:{self.port}")

    def destroy_node(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().destroy_node()

    def load_floor_config(self):
        configured = str(self.get_parameter("stations_config").value or "").strip()
        candidates = []
        if configured:
            candidates.append(Path(configured).expanduser())
        if get_package_share_directory is not None:
            try:
                candidates.append(Path(get_package_share_directory("print_robot_bridge")) / "config" / "office_3f.json")
            except Exception:
                pass
        candidates.append(Path(__file__).resolve().parents[1] / "config" / "office_3f.json")

        for path in candidates:
            if path.exists():
                with path.open("r", encoding="utf-8") as handle:
                    self.get_logger().info(f"Loaded station config: {path}")
                    return json.load(handle)

        self.get_logger().warning("Station config not found; using built-in fallback stations")
        return {
            "floor": "3F 办公区",
            "stations": [
                {
                    "id": "CHG",
                    "label": "充电点",
                    "type": "dock",
                    "ui": {"x": 782, "y": 434},
                    "ros": {"x": 7.5, "y": -1.2, "yaw": 3.14},
                },
                {
                    "id": "C-05",
                    "label": "产品 C-05",
                    "type": "desk",
                    "ui": {"x": 466, "y": 330},
                    "ros": {"x": 4.1, "y": 0.1, "yaw": 1.57},
                },
            ],
        }

    @staticmethod
    def normalize_station(station):
        ui = station.get("ui", {})
        return {
            **station,
            "type": station.get("type", "desk"),
            "x": ui.get("x", station.get("x", 0)),
            "y": ui.get("y", station.get("y", 0)),
        }

    def find_station_by_type(self, station_type):
        return next((station for station in self.stations.values() if station.get("type") == station_type), None)

    def default_status(self):
        home_station = self.home_station or {}
        return {
            "robot": {
                "state": "idle",
                "floor": self.floor_config.get("floor", "3F 办公区"),
                "location": home_station.get("label", "充电点"),
                "x": home_station.get("x", 782),
                "y": home_station.get("y", 434),
                "battery": 100,
                "speed": 0,
            },
            "printer": {
                "state": "idle",
                "activeJobId": "",
                "queueLength": 0,
                "waitSeconds": 0,
                "progress": 0,
            },
            "network": {
                "ip": self.local_ip(),
                "rssi": 0,
            },
            "updatedAt": self.iso_now(),
        }

    def on_status(self, msg):
        try:
            payload = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warning("Ignoring /print_robot/status because data is not JSON")
            return

        with self.lock:
            self.status = {**self.status, **payload, "updatedAt": self.iso_now()}

    def on_job_state(self, msg):
        try:
            payload = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warning("Ignoring /print_robot/jobs/state because data is not JSON")
            return

        with self.lock:
            if isinstance(payload.get("jobs"), list):
                self.jobs = {job["id"]: job for job in payload["jobs"] if "id" in job}
            elif isinstance(payload.get("job"), dict) and payload["job"].get("id"):
                job_id = payload["job"]["id"]
                current = self.jobs.get(job_id, {})
                self.jobs[job_id] = {**current, **payload["job"]}
            self.sync_status_queue_locked()

    def submit_job(self, fields, file_item):
        job_id = f"JOB-{int(time.time() * 1000) % 1000000:06d}"
        original_name = Path(file_item.filename or "document.pdf").name
        job_dir = self.upload_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        file_path = job_dir / original_name

        with file_path.open("wb") as handle:
            while True:
                chunk = file_item.file.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)

        target_station = fields.get("targetStation", "C-05")
        station = self.stations.get(target_station, {})
        job = {
            "id": job_id,
            "fileName": original_name,
            "filePath": str(file_path),
            "recipient": fields.get("recipient", ""),
            "targetStation": target_station,
            "targetLabel": station.get("label", target_station),
            "targetPose": station.get("ros"),
            "targetUi": station.get("ui"),
            "pickupCode": fields.get("pickupCode", ""),
            "status": "queued",
            "progress": 0,
            "printSettings": {
                "copies": int(fields.get("copies", "1") or 1),
                "pages": fields.get("pages", "全部"),
                "colorMode": fields.get("colorMode", "mono"),
                "duplex": fields.get("duplex", "single"),
                "paperSize": fields.get("paperSize", "A4"),
                "priority": fields.get("priority", "normal"),
                "printMode": fields.get("printMode", "mobile_print"),
            },
            "submittedAt": fields.get("submittedAt", self.iso_now()),
            "createdAt": self.iso_now(),
        }

        with self.lock:
            self.jobs[job_id] = job
            self.sync_status_queue_locked()

        self.publish_json(self.job_publisher, job)
        return job

    def cancel_job(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job and job.get("status") in self.active_job_statuses:
                job["status"] = "canceled"
                job["progress"] = 0
            self.sync_status_queue_locked()

        self.publish_json(self.cancel_publisher, {"id": job_id, "requestedAt": self.iso_now()})
        return job

    def sync_status_queue_locked(self):
        active_jobs = [
            job for job in self.jobs.values() if job.get("status") in self.active_job_statuses
        ]
        queued_jobs = [job for job in active_jobs if job.get("status") == "queued"]
        self.status.setdefault("printer", {})
        self.status["printer"]["queueLength"] = len(active_jobs)
        self.status["printer"]["waitSeconds"] = len(queued_jobs) * 120
        self.status["updatedAt"] = self.iso_now()

    def make_handler(self):
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def do_OPTIONS(self):
                self.send_response(204)
                self.set_cors()
                self.end_headers()

            def do_GET(self):
                parsed = urlparse(self.path)
                if parsed.path == "/api/health":
                    self.send_json({"ok": True, "name": "print_robot_bridge"})
                    return
                if parsed.path == "/api/status":
                    with bridge.lock:
                        payload = dict(bridge.status)
                    self.send_json(payload)
                    return
                if parsed.path == "/api/jobs":
                    with bridge.lock:
                        payload = {"jobs": sorted(bridge.jobs.values(), key=lambda item: item.get("createdAt", ""), reverse=True)}
                    self.send_json(payload)
                    return
                if parsed.path == "/api/floor-config":
                    self.send_json(bridge.floor_config)
                    return
                self.send_json({"ok": False, "error": "not found"}, status=404)

            def do_POST(self):
                parsed = urlparse(self.path)
                if parsed.path == "/api/jobs":
                    self.handle_submit_job()
                    return

                parts = parsed.path.strip("/").split("/")
                if len(parts) == 4 and parts[0] == "api" and parts[1] == "jobs" and parts[3] == "cancel":
                    job_id = unquote(parts[2])
                    job = bridge.cancel_job(job_id)
                    self.send_json({"ok": job is not None, "job": job})
                    return

                self.send_json({"ok": False, "error": "not found"}, status=404)

            def handle_submit_job(self):
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={
                        "REQUEST_METHOD": "POST",
                        "CONTENT_TYPE": self.headers.get("Content-Type"),
                    },
                )

                file_item = form["file"] if "file" in form else None
                if file_item is None or not getattr(file_item, "filename", ""):
                    self.send_json({"ok": False, "error": "file is required"}, status=400)
                    return

                fields = {}
                for key in form.keys():
                    if key == "file":
                        continue
                    item = form[key]
                    fields[key] = item.value if hasattr(item, "value") else str(item)

                job = bridge.submit_job(fields, file_item)
                self.send_json({"ok": True, "job": job}, status=201)

            def send_json(self, payload, status=200):
                encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.set_cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def set_cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

            def log_message(self, fmt, *args):
                bridge.get_logger().debug(fmt % args)

        return Handler

    def publish_json(self, publisher, payload):
        msg = String()
        msg.data = json.dumps(payload, ensure_ascii=False)
        publisher.publish(msg)

    @staticmethod
    def iso_now():
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    @staticmethod
    def local_ip():
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(("8.8.8.8", 80))
                return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def main(args=None):
    rclpy.init(args=args)
    node = PrintRobotBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
