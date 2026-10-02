<?php
// Atomic code pointer; account config, sessions and SQLite stay in LW_PRIVATE.
$release=trim(file_get_contents(LW_PRIVATE.'/current-release.txt'));
if(!preg_match('/^(?:[a-f0-9]{40}|bootstrap-[a-f0-9]{16})$/',$release))throw new RuntimeException('Invalid release');
header('X-LumeWorks-Revision: '.$release);
define('LW_CODE',LW_PRIVATE.'/releases/'.$release);
require LW_CODE.'/app.php';
