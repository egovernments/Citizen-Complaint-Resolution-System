<?php
/**
 * Headless Matomo install (issue #1254).
 *
 * Replaces the 8-step browser wizard for the compose tier. Does what
 * plugins/Installation/Controller.php does, through Matomo's own API rather
 * than by driving its forms, and bootstraps exactly the way `console` does.
 *
 * RUN IT TWICE. This is not defensive habit, it is required:
 *
 *   pass 1   creates the schema, the superuser and trusted_hosts, and DEFERS
 *            the site
 *   pass 2   installs the bundled plugins, runs component updates, creates the
 *            site
 *
 * The reason is process-scoped state. Environment->init() builds the plugin
 * manager's view of the world at startup, and on pass 1 that happens against an
 * empty database — so installLoadedPlugins() later in the same process sees a
 * stale view and does nothing. A second process, starting against the schema
 * pass 1 laid down, gets it right. Attempting it in one pass yields an install
 * that LOOKS complete (schema, superuser and site all present, UI loads) but
 * answers every tracking request with HTTP 400, because the tracker touches
 * matomo_custom_dimensions and no plugin table was ever created.
 *
 * `console core:update` is NOT needed alongside this — measured: pass 2's own
 * component update covers it, and the result tracks (HTTP 200, action stored).
 *
 * Every step is individually guarded, so re-running on an installed instance is
 * a no-op and safe on every redeploy.
 *
 * MUST run as www-data (`docker exec -u www-data`). Running as root leaves
 * root-owned files under tmp/ and config/, and the next www-data run dies with
 * `The directory "/var/www/html/tmp/cache/tracker/" is not writable.`
 *
 * Env in: MB_LOGIN, MB_PASSWORD, MB_EMAIL, MB_SITE_NAME, MB_SITE_URL,
 *         MB_TRUSTED_HOSTS (comma-separated, optional).
 * Exit:   0 with INSTALLED / NOCHANGE / PASS1_DONE on the last line; 1 on error.
 */

ini_set('display_errors', '1');
error_reporting(E_ALL);

if (!defined('PIWIK_DOCUMENT_ROOT')) {
    define('PIWIK_DOCUMENT_ROOT', '/var/www/html');
}
if (!defined('PIWIK_INCLUDE_PATH')) {
    define('PIWIK_INCLUDE_PATH', PIWIK_DOCUMENT_ROOT);
}
require_once PIWIK_INCLUDE_PATH . '/core/bootstrap.php';

use Piwik\Access;
use Piwik\Config;
use Piwik\DbHelper;
use Piwik\Plugins\SitesManager\API as SitesManagerAPI;
use Piwik\Plugins\UsersManager\API as UsersManagerAPI;
use Piwik\Plugins\UsersManager\Model as UsersManagerModel;
use Piwik\Updater;
use Piwik\Version;

function envOrDie($name)
{
    $v = getenv($name);
    if ($v === false || $v === '') {
        fwrite(STDERR, "FATAL missing env $name\n");
        exit(2);
    }
    return $v;
}

$login    = envOrDie('MB_LOGIN');
$password = envOrDie('MB_PASSWORD');
$email    = envOrDie('MB_EMAIL');
$siteName = envOrDie('MB_SITE_NAME');
$siteUrl  = envOrDie('MB_SITE_URL');
$trusted  = getenv('MB_TRUSTED_HOSTS');

$changed = false;

try {
    $environment = new \Piwik\Application\Environment(null);
    $environment->init();

    // ── 1. schema ────────────────────────────────────────────────────────
    $tables = DbHelper::getTablesInstalled(true);
    if (count($tables) < 5) {
        echo "step1 creating schema\n";
        DbHelper::createTables();
        DbHelper::createAnonymousUser();
        DbHelper::recordInstallVersion();
        // The INSTANCE method, not the static wrapper. Updater's static
        // recordComponentSuccessfullyUpdated() forwards to self::$activeInstance,
        // which is only set once an Updater has been constructed and activated —
        // true inside the web installer, not in a standalone script, where it
        // fatals with "Call to a member function ... on null".
        (new Updater())->markComponentSuccessfullyUpdated('core', Version::VERSION);
        $changed = true;
    } else {
        echo "step1 schema present (" . count($tables) . " tables)\n";
    }

    // ── 1a. install the bundled plugins ──────────────────────────────────
    // The step that is easy to miss entirely, because in a browser install it
    // is not part of the wizard at all: FrontController::init() calls it on
    // every request (core/FrontController.php, guarded only against the
    // installer's own CSS/JS actions). A standalone CLI script never goes
    // through FrontController, so without this the config gets no
    // [PluginsInstalled] section, every plugin's install() never runs, and
    // their tables are never created.
    //
    // That failure is quiet and nasty: schema, superuser and site all end up
    // present and the UI loads, but the tracker returns HTTP 400 on every hit
    // because it touches matomo_custom_dimensions, which does not exist.
    Access::getInstance();
    Access::doAsSuperUser(function () use (&$changed) {
        $before = Config::getInstance()->PluginsInstalled;
        \Piwik\Plugin\Manager::getInstance()->installLoadedPlugins();
        $after = Config::getInstance()->PluginsInstalled;
        if ($before != $after) {
            Config::getInstance()->forceSave();
            $n = isset($after['PluginsInstalled']) ? count($after['PluginsInstalled']) : 0;
            echo "step1a installed $n plugins\n";
            $changed = true;
        } else {
            echo "step1a plugins already installed\n";
        }
    });

    // ── 1b. component updates ────────────────────────────────────────────
    // NOT optional, and not something `console core:update` covers on a fresh
    // schema. DbHelper::createTables() lays down CORE tables only; plugin tables
    // (matomo_custom_dimensions and friends) are created by each plugin's
    // updater. Skip this and you get an install that looks complete — schema,
    // superuser and site all present — but answers every tracking request with
    // HTTP 400, because the tracker touches a plugin table that was never made.
    // This is Installation/Controller.php::updateComponents(), verbatim.
    Access::doAsSuperUser(function () use (&$changed) {
        $updater = new Updater();
        $components = $updater->getComponentUpdates();
        if (!empty($components)) {
            echo "step1b updating " . count($components) . " components\n";
            $updater->updateComponents($components);
            $changed = true;
        } else {
            echo "step1b components already current\n";
        }
    });

    // ── 2. superuser ─────────────────────────────────────────────────────
    // "anonymous" always exists (createAnonymousUser above), so presence of a
    // user row is not the test — presence of a SUPERUSER is.
    $hasSuperUser = false;
    Access::doAsSuperUser(function () use (&$hasSuperUser) {
        foreach (UsersManagerAPI::getInstance()->getUsers() as $u) {
            if (!empty($u['superuser_access'])) {
                $hasSuperUser = true;
            }
        }
    });

    if (!$hasSuperUser) {
        echo "step2 creating superuser $login\n";
        Access::doAsSuperUser(function () use ($login, $password, $email) {
            UsersManagerAPI::getInstance()->addUser($login, $password, $email);
            // Model, not UserUpdater. UserUpdater::setSuperUserAccessWithout-
            // CurrentPassword() dispatches through Piwik\API\Request, which
            // builds a ResponseBuilder from the request's `format` var — absent
            // in CLI, so it resolves to 'console' and throws "Renderer format
            // 'console' not valid". The Model writes the same single column
            // (superuser_access) with none of the HTTP machinery.
            (new UsersManagerModel())->setSuperUserAccess($login, true);
        });
        $changed = true;
    } else {
        echo "step2 superuser already exists\n";
    }

    // ── 3. site ──────────────────────────────────────────────────────────
    // DEFERRABLE ON PURPOSE. Measurable types ("website") are contributed by
    // plugins that are only registered once component updates have run, so on a
    // brand-new schema addSite() throws "Invalid website type website". Matomo's
    // own wizard hits this ordering too and solves it by running
    // updateComponents() at the tables step, before the site step.
    //
    // So the caller runs this script twice: pass 1 lays down schema + superuser
    // and defers the site, pass 2 — a fresh process, whose plugin manager can
    // see the schema — installs the plugins and creates it. Every step is
    // individually guarded, so the second pass is cheap.
    $idSite = null;
    $siteDeferred = false;
    try {
        Access::doAsSuperUser(function () use (&$idSite, $siteName, $siteUrl) {
            $ids = SitesManagerAPI::getInstance()->getAllSitesId();
            if (empty($ids)) {
                $idSite = SitesManagerAPI::getInstance()->addSite($siteName, $siteUrl);
            } else {
                $idSite = $ids[0];
            }
        });
        echo "step3 SITE_ID=$idSite\n";
        $changed = $changed || $idSite !== null;
    } catch (\Throwable $e) {
        $siteDeferred = true;
        echo "step3 DEFERRED (" . $e->getMessage() . ") — expected on pass 1; pass 2 creates it\n";
    }

    // ── 4. trusted hosts ─────────────────────────────────────────────────
    // The wizard derives these from the Host it was reached on. Headless has no
    // request, so the caller supplies them.
    if (!empty($trusted)) {
        $wanted = array_values(array_filter(array_map('trim', explode(',', $trusted))));
        $config = Config::getInstance();
        $general = $config->General;
        $current = isset($general['trusted_hosts']) ? $general['trusted_hosts'] : [];
        if ($current != $wanted) {
            $general['trusted_hosts'] = $wanted;
            $config->General = $general;
            $config->forceSave();
            echo "step4 trusted_hosts=" . implode(',', $wanted) . "\n";
            $changed = true;
        } else {
            echo "step4 trusted_hosts already correct\n";
        }
    }
} catch (\Throwable $e) {
    fwrite(STDERR, "FATAL " . get_class($e) . ": " . $e->getMessage() . "\n");
    fwrite(STDERR, $e->getTraceAsString() . "\n");
    exit(1);
}

if ($siteDeferred) {
    echo "PASS1_DONE\n";   // caller: run this script once more
    exit(0);
}
echo $changed ? "INSTALLED\n" : "NOCHANGE\n";
