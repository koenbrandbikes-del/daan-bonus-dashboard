#!/usr/bin/env python3
"""Reuse all existing financial parsing/validation, replacing only public CSV transport."""
import importlib.util,pathlib
from private_sheets import fetch_csv
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('creators_producer',root/'scripts/sync_creators.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.fetch_csv=fetch_csv
if __name__=='__main__':module.main()
