from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            DeclareLaunchArgument("host", default_value="0.0.0.0"),
            DeclareLaunchArgument("port", default_value="8080"),
            DeclareLaunchArgument("upload_dir", default_value="/tmp/print_robot_uploads"),
            DeclareLaunchArgument("stations_config", default_value=""),
            DeclareLaunchArgument("backend", default_value="cups"),
            DeclareLaunchArgument("printer_name", default_value=""),
            DeclareLaunchArgument("print_command", default_value="lp"),
            DeclareLaunchArgument("usb_device", default_value="/dev/usb/lp0"),
            DeclareLaunchArgument("auto_print_modes", default_value="mobile_print"),
            Node(
                package="print_robot_bridge",
                executable="bridge_node",
                name="print_robot_bridge",
                output="screen",
                parameters=[
                    {
                        "host": LaunchConfiguration("host"),
                        "port": LaunchConfiguration("port"),
                        "upload_dir": LaunchConfiguration("upload_dir"),
                        "stations_config": LaunchConfiguration("stations_config"),
                    }
                ],
            ),
            Node(
                package="print_robot_bridge",
                executable="usb_printer_node",
                name="usb_printer_node",
                output="screen",
                parameters=[
                    {
                        "backend": LaunchConfiguration("backend"),
                        "printer_name": LaunchConfiguration("printer_name"),
                        "print_command": LaunchConfiguration("print_command"),
                        "usb_device": LaunchConfiguration("usb_device"),
                        "auto_print_modes": LaunchConfiguration("auto_print_modes"),
                    }
                ],
            ),
        ]
    )
