import os

root_dir = "apps/api/app"
target_line = "from __future__ import annotations"

for dirpath, _, filenames in os.walk(root_dir):
    for filename in filenames:
        if filename.endswith(".py"):
            filepath = os.path.join(dirpath, filename)
            with open(filepath, "r") as f:
                content = f.read()
            
            if target_line not in content:
                print(f"Adding future annotation to {filepath}")
                with open(filepath, "w") as f:
                    f.write(f"{target_line}\n\n{content}")
