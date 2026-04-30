# Generated EF Source Index

This directory is reserved for generated source-library indexes.

Run from `ghg-engine-prototype`:

```powershell
uv run python tools/index_ef_sources.py
```

The default output is `efs/index/ef_library.sqlite` relative to the repository
root. The SQLite file is generated and should not be hand-edited.
