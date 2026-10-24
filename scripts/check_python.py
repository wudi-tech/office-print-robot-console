"""Parse every archived Python source without importing ROS or creating bytecode."""
import ast
from pathlib import Path

root = Path(__file__).resolve().parents[1]
files = sorted(p for p in root.rglob('*.py') if '.git' not in p.parts)
for path in files:
    ast.parse(path.read_text(encoding='utf-8-sig'), filename=path.relative_to(root).as_posix())
print(f'Python syntax: PASS ({len(files)} files; no ROS imports or hardware calls)')
