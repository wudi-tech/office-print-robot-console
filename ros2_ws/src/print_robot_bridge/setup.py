from setuptools import setup

package_name = "print_robot_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (
            f"share/{package_name}/launch",
            [
                "launch/bridge.launch.py",
                "launch/usb_printer.launch.py",
                "launch/robot_print_system.launch.py",
            ],
        ),
        (f"share/{package_name}/config", ["config/office_3f.json"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Print Robot Team",
    maintainer_email="team@example.com",
    description="HTTP bridge for the office print delivery robot web console.",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "bridge_node = print_robot_bridge.bridge_node:main",
            "usb_printer_node = print_robot_bridge.usb_printer_node:main",
        ],
    },
)
