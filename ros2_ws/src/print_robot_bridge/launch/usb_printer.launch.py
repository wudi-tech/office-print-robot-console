from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            DeclareLaunchArgument("backend", default_value="cups"),
            DeclareLaunchArgument("printer_name", default_value=""),
            DeclareLaunchArgument("print_command", default_value="lp"),
            DeclareLaunchArgument("usb_device", default_value="/dev/usb/lp0"),
            DeclareLaunchArgument("auto_print_modes", default_value="mobile_print"),
            DeclareLaunchArgument("command_timeout_sec", default_value="180"),
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
                        "command_timeout_sec": LaunchConfiguration("command_timeout_sec"),
                    }
                ],
            ),
        ]
    )
