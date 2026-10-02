<?php
declare(strict_types=1);
// There are no dashboard files or financial JSON files in the document root.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
umask(0077);
try {
    $private = getenv('LW_PRIVATE_DIR') ?: (is_file(__DIR__.'/private-path.php') ? require __DIR__.'/private-path.php' : '');
    if (!$private || !is_file($private.'/config.json') || !is_file($private.'/app.php')) {
        http_response_code(503);
        header('Cache-Control: no-store');
        header('Content-Type: text/plain; charset=utf-8');
        exit('LumeWorks • Cijfers wordt klaargezet. Probeer het later opnieuw.');
    }
    define('LW_PRIVATE', $private);
    require $private.'/app.php';
} catch (Throwable $e) {
    error_log('LumeWorks request failed: '.$e->getMessage());
    http_response_code(503);
    header('Cache-Control: no-store');
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Cijfers is tijdelijk niet beschikbaar. Probeer het opnieuw.';
}
