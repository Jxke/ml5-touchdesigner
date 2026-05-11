"""
Import built browser files from _mpdist into this component's virtualFile VFS.

Run this from a TouchDesigner Text DAT inside the main ML5 component after
running `corepack yarn build` in the repo root.
"""

from pathlib import Path


def _repo_root():
    # If the .toe is saved in the repo root, project.folder is the safest path.
    try:
        return Path(project.folder)
    except Exception:
        return Path.cwd()


def _purge_vfs(vfs_op):
    vfiles = []
    print("Found", len(vfs_op.vfs), "virtual file(s) for deletion")

    for f in vfs_op.vfs:
        vfiles.append(f.name)

    for v in vfiles:
        print("Deleting", v)
        vfs_op.vfs[v].destroy()


def import_mpdist_to_vfs(dist_folder=None, vfs_op=None):
    root = _repo_root()
    dist_path = Path(dist_folder) if dist_folder else root / "_mpdist"
    target_vfs = vfs_op or op("virtualFile")

    if not dist_path.exists():
        raise FileNotFoundError(
            "Could not find _mpdist at {}. Run `corepack yarn build` from the repo root first.".format(dist_path)
        )

    _purge_vfs(target_vfs)

    imported = 0
    for filename in dist_path.rglob("*"):
        if filename.is_file():
            relative_path = filename.relative_to(dist_path)
            vfs_name = "#" + "#".join(relative_path.parts)
            print("Importing", relative_path, "as", vfs_name)
            target_vfs.vfs.addFile(str(filename), overrideName=vfs_name)
            imported += 1

    print("Imported", imported, "file(s) into", target_vfs.path)
    return imported


def onStart():
    return


def onCreate():
    import_mpdist_to_vfs()
    return


if __name__ == "__main__":
    import_mpdist_to_vfs()
