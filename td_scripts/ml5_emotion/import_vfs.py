"""
Import built browser files from _mpdist into this component's virtualFile VFS.

Run this from a TouchDesigner Text DAT inside the main ML5 component after
running `corepack yarn build` in the repo root.
"""

from pathlib import Path


def _repo_root():
    for root in _candidate_roots():
        if (root / "_mpdist" / "index.html").exists():
            return root

    # If the .toe is saved in the repo root, project.folder is usually safest.
    try:
        return Path(project.folder)
    except Exception:
        return Path.cwd()


def _candidate_roots():
    roots = []

    try:
        roots.append(Path(project.folder))
    except Exception:
        pass

    try:
        roots.append(Path.cwd())
    except Exception:
        pass

    expanded = []
    for root in roots:
        try:
            root = root.resolve()
        except Exception:
            pass

        expanded.append(root)
        expanded.extend(root.parents)

    seen = set()
    for root in expanded:
        key = str(root)
        if key in seen:
            continue
        seen.add(key)
        yield root


def _purge_vfs(vfs_op):
    vfiles = []
    print("Found", len(vfs_op.vfs), "virtual file(s) for deletion")

    for f in vfs_op.vfs:
        vfiles.append(f.name)

    for v in vfiles:
        print("Deleting", v)
        vfs_op.vfs[v].destroy()


def _dist_files(dist_path):
    files = sorted([path for path in dist_path.rglob("*") if path.is_file()])

    if not files:
        raise RuntimeError("_mpdist exists but contains no files: {}".format(dist_path))

    if not (dist_path / "index.html").exists():
        raise RuntimeError("_mpdist is missing index.html: {}".format(dist_path))

    return files


def import_mpdist_to_vfs(dist_folder=None, vfs_op=None, purge_stale=False):
    root = _repo_root()
    dist_path = Path(dist_folder) if dist_folder else root / "_mpdist"
    target_vfs = vfs_op or op("virtualFile")

    if target_vfs is None:
        raise RuntimeError("Could not find virtualFile operator")

    if not dist_path.exists():
        raise FileNotFoundError(
            "Could not find _mpdist at {}. Run `corepack yarn build` from the repo root first.".format(dist_path)
        )

    files = _dist_files(dist_path)
    imported_names = []

    imported = 0
    for filename in files:
        relative_path = filename.relative_to(dist_path)
        vfs_name = "#" + "#".join(relative_path.parts)
        print("Importing", relative_path, "as", vfs_name)
        target_vfs.vfs.addFile(str(filename), overrideName=vfs_name)
        imported_names.append(vfs_name)
        imported += 1

    if purge_stale:
        imported_lookup = set(imported_names)
        stale = []
        for f in target_vfs.vfs:
            if f.name not in imported_lookup:
                stale.append(f.name)

        for name in stale:
            print("Deleting stale VFS file", name)
            target_vfs.vfs[name].destroy()

    print("Imported", imported, "file(s) into", target_vfs.path)
    return imported


def onStart():
    return


def onCreate():
    import_mpdist_to_vfs()
    return


if __name__ == "__main__":
    import_mpdist_to_vfs()
