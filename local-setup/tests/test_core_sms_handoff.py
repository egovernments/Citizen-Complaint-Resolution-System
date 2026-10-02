#!/usr/bin/env python3
"""The shell that recreates novu-bridge first on an upgrade and retires the old OTP senders
(egov-notification-sms, otp-publisher) — run for real, against a fake `docker` on PATH.

Vinoth re-review of #2097:
  4141822018  `set -o pipefail` without -e swallowed a failed `up -d novu-bridge`; the OLD
              bridge was still running, so BRIDGE-RUNNING printed and the senders went.
  4141822022  CoreSmsConsumer starts at the END of egov.core.notification.sms when its group
              has no committed offset there, so removing the senders as soon as the new
              container ran lost every OTP published during its boot.

The tasks' shell is taken from playbook-deploy.yml and rendered with Jinja2, so this tests the
text the deploy runs; local-setup/scripts/core-sms-handoff.sh is the helper both the playbook
and enable-notifications.sh source. The rpk output below is copied from Redpanda v24.1.1 (the
compose image).

Run: python3 -m unittest local-setup/tests/test_core_sms_handoff.py
"""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest

try:
    import jinja2
    import yaml
except ImportError:  # pragma: no cover
    jinja2 = yaml = None
try:
    from ansible.parsing.splitter import split_args
except ImportError:  # pragma: no cover
    split_args = None

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PLAYBOOK = os.path.join(REPO, "local-setup", "ansible", "playbook-deploy.yml")
HELPER = os.path.join(REPO, "local-setup", "scripts", "core-sms-handoff.sh")
ENABLE = os.path.join(REPO, "local-setup", "scripts", "enable-notifications.sh")

T_BRIDGE_FIRST = "notification stack — recreate novu-bridge before pgr-services (upgrade order)"
T_EARLY = "notification stack — remove the retired OTP senders now (a recreated bridge took over the OTP topic)"
T_LATE = "notification stack — remove the retired OTP senders once novu-bridge took over the OTP topic"

TOPIC = "egov.core.notification.sms"
TOPIC_1P = textwrap.dedent("""\
    PARTITION  LEADER  EPOCH  REPLICAS  LOG-START-OFFSET  HIGH-WATERMARK
    0          0       1      [0]       0                 4
    """)
TOPIC_2P = TOPIC_1P + "1          0       1      [0]       0                 0\n"
TOPIC_NONE = "PARTITION  LEADER  EPOCH  REPLICAS  LOG-START-OFFSET  HIGH-WATERMARK\n"
_GROUP_HEAD = textwrap.dedent("""\
    GROUP        novu-bridge
    COORDINATOR  0
    STATE        {state}
    BALANCER     range
    MEMBERS      {members}
    TOTAL-LAG    0

    TOPIC                       PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   MEMBER-ID                                 CLIENT-ID  HOST
    """)
MEMBER = "consumer-novu-bridge-2-6ade828c-8a5a-4e26-8287-580912fd59ff  consumer-novu-bridge-2  /172.18.0.9"


def group(*rows, state="Stable", members=1):
    return _GROUP_HEAD.format(state=state, members=members) + "".join(r + "\n" for r in rows)


# the new bridge's DomainEventConsumer is in, its CoreSmsConsumer has not been assigned yet
GROUP_NOTHING = group("complaints.domain.events    0          12              12              0     " + MEMBER)
GROUP_DEAD = _GROUP_HEAD.split("\n\nTOPIC")[0].format(state="Dead", members=0) + "\n"
# assigned to a live member, nothing committed yet (auto.offset.reset=latest, no OTP since)
GROUP_ASSIGNED = group(TOPIC + "  0          -               4               -     " + MEMBER)
# committed by an earlier bridge; nobody is a member right now (unassigned rows end early)
GROUP_COMMITTED = group(TOPIC + "  0          4               4               0     ", state="Empty", members=0)
# two partitions: one committed, one neither committed nor owned
GROUP_HALF = group(TOPIC + "  0          4               4               0     ",
                   TOPIC + "  1          -               0               -     ", state="Empty", members=0)

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
state_path = os.environ["FAKE_STATE"]
with open(state_path) as fh:
    st = json.load(fh)
with open(os.environ["FAKE_LOG"], "a") as fh:
    fh.write(" ".join(sys.argv[1:]) + "\n")
args = sys.argv[1:]

def save():
    with open(state_path, "w") as fh:
        json.dump(st, fh)

def out(text, rc=0):
    sys.stdout.write(text)
    sys.exit(rc)

def seq(key):
    vals = st[key]
    if isinstance(vals, list):
        v = vals[0] if len(vals) == 1 else vals.pop(0)
        save()
        return v
    return vals

if args[0] == "compose":
    if "up" in args:
        sys.stdout.write("Container novu-bridge  Recreate\n")
        if st.get("up_rc", 0) != 0:
            sys.stdout.write("Error response from daemon: pull access denied\n")
            sys.exit(st["up_rc"])
        if "after_up" in st:
            st["containers"]["novu-bridge"] = st.pop("after_up")
            save()
        out("Container novu-bridge  Started\n")
    # like compose: a service's dependencies come along, listed first
    if "--images" in args:
        out("egovio/redpanda:v24.1.1\n" + st["want_image"] + "\n")
    if "--format" in args and "json" in args:
        out(json.dumps({"services": {"redpanda": {"image": "egovio/redpanda:v24.1.1"},
                                     "novu-bridge": {"image": st["want_image"]}}}))
    if "--hash" in args:
        out("novu-bridge %s\n" % st["want_hash"])
    sys.exit(2)
if args[0] == "image" and args[1] == "inspect":
    ref = args[-1]
    if ref in st.get("images", {}):
        out(st["images"][ref] + "\n")
    sys.exit(1)
if args[0] == "rm":
    st["containers"].pop(args[-1], None)
    save()
    sys.exit(0)
if args[0] == "exec":
    if args[1] != "digit-redpanda" or st.get("rpk_down"):
        out("Error: No such container\n", 1)
    rpk = args[3:]  # exec digit-redpanda rpk <...>
    if rpk[:2] == ["topic", "describe"]:
        out(seq("rpk_topic"))
    if rpk[:2] == ["group", "describe"]:
        out(seq("rpk_group"))
    if rpk[:2] == ["topic", "create"]:
        out("TOPIC  STATUS\n%s  OK\n" % rpk[2])
    sys.exit(3)
if args[0] == "inspect":
    name = args[-1]
    c = st["containers"].get(name)
    if c is None:
        sys.stderr.write("Error: No such object: %s\n" % name)
        sys.exit(1)
    if len(args) == 2:
        out("[{}]\n")
    fmt = args[2]
    if ".Image}}|" in fmt:
        fields = [c["image"], c["hash"]]
        if ".State.Running" in fmt:
            fields.append("true" if c.get("running", True) else "false")
        out("|".join(fields) + "\n")
    if ".State.Health" in fmt:
        out(c.get("health", "running") + "\n")
    if ".Config.Env" in fmt:
        out("".join("%s=%s\n" % kv for kv in c.get("env", {}).items()))
    if "com.docker.compose.service" in fmt:
        out("%s|%s\n" % (c.get("service", name), c.get("workdir", st["digit_dir"])))
    sys.exit(4)
sys.exit(5)
'''


def task_shell(name, digit_dir):
    with open(PLAYBOOK, encoding="utf-8") as fh:
        plays = yaml.safe_load(fh)
    for play in plays:
        for t in play.get("tasks", []) or []:
            if t.get("name") == name:
                src = t["ansible.builtin.shell"]
                return jinja2.Template(src).render(
                    digit_dir=digit_dir, compose_profiles="notifications",
                    compose_files="-f docker-compose.egov-digit.yaml",
                    compose_progress_file=os.path.join(digit_dir, "progress.log")), t
    raise AssertionError("task not found: " + name)


@unittest.skipIf(jinja2 is None, "needs jinja2 + PyYAML (ansible's own dependencies)")
class Harness(unittest.TestCase):
    OLD = {"image": "sha256:old", "hash": "h-old", "running": True, "health": "healthy"}
    NEW = {"image": "sha256:new", "hash": "h-new", "running": True, "health": "healthy"}
    SENDER = {"image": "sha256:sms", "hash": "x", "running": True}

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="csh-")
        self.addCleanup(shutil.rmtree, self.dir)
        self.digit_dir = os.path.join(self.dir, "digit")
        os.makedirs(self.digit_dir)
        shutil.copy(HELPER, os.path.join(self.digit_dir, "core-sms-handoff.sh"))
        self.bin = os.path.join(self.dir, "bin")
        os.makedirs(self.bin)
        for name, body in (("docker", FAKE_DOCKER), ("sleep", "#!/bin/sh\nexit 0\n")):
            path = os.path.join(self.bin, name)
            with open(path, "w") as fh:
                fh.write(body)
            os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
        self.state_path = os.path.join(self.dir, "state.json")
        self.log = os.path.join(self.dir, "docker.log")
        open(self.log, "w").close()

    def state(self, **st):
        base = {"digit_dir": self.digit_dir, "containers": {}, "want_image": "egovio/novu-bridge:new",
                "want_hash": "h-new", "images": {"egovio/novu-bridge:new": "sha256:new", "egovio/redpanda:v24.1.1": "sha256:rp"},
                "rpk_topic": TOPIC_1P, "rpk_group": GROUP_ASSIGNED}
        base.update(st)
        with open(self.state_path, "w") as fh:
            json.dump(base, fh)

    def containers(self):
        with open(self.state_path) as fh:
            return json.load(fh)["containers"]

    def senders(self):
        return {"egov-notification-sms": dict(self.SENDER, service="egov-notification-sms"),
                "otp-publisher": dict(self.SENDER, service="otp-publisher")}

    def run_task(self, name):
        script, _ = task_shell(name, self.digit_dir)
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"],
                   FAKE_STATE=self.state_path, FAKE_LOG=self.log)
        return subprocess.run(["/bin/bash", "-c", script], cwd=self.digit_dir, env=env,
                              capture_output=True, text=True, timeout=60)


@unittest.skipIf(split_args is None or yaml is None, "needs ansible-core")
class AnsibleParsesTheShell(unittest.TestCase):
    """The shell module splits its free-form text before running it and refuses unbalanced
    quotes — an apostrophe in a `#` comment included ("failed at splitting arguments")."""

    def test_every_task_here_splits(self):
        with open(PLAYBOOK, encoding="utf-8") as fh:
            plays = yaml.safe_load(fh)
        names = (T_BRIDGE_FIRST, T_EARLY, T_LATE)
        found = {t["name"]: t["ansible.builtin.shell"] for p in plays for t in p.get("tasks", []) or []
                 if t.get("name") in names}
        self.assertEqual(set(found), set(names))
        for name, src in found.items():
            with self.subTest(task=name):
                split_args(src)  # raises AnsibleParserError on unbalanced quotes / jinja blocks


class BridgeFirst(Harness):
    def test_fresh_install_has_nothing_to_order(self):
        self.state()
        r = self.run_task(T_BRIDGE_FIRST)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("NOCHANGE", r.stdout)

    def test_a_failed_up_fails_the_task_even_though_the_old_bridge_still_runs(self):
        self.state(containers={"novu-bridge": self.OLD}, up_rc=1)
        r = self.run_task(T_BRIDGE_FIRST)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("BRIDGE-UP-FAILED", r.stderr)
        self.assertNotIn("BRIDGE-RUNNING", r.stdout)

    def test_a_successful_up_that_left_the_old_container_is_not_taken_for_the_new_one(self):
        # compose answered 0 but novu-bridge is still the old image/config
        self.state(containers={"novu-bridge": self.OLD})
        r = self.run_task(T_BRIDGE_FIRST)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("BRIDGE-NOT-CURRENT", r.stderr)
        self.assertNotIn("BRIDGE-RUNNING", r.stdout)

    def test_the_old_image_under_a_new_config_is_not_current(self):
        self.state(containers={"novu-bridge": self.OLD}, after_up=dict(self.OLD, hash="h-new"))
        r = self.run_task(T_BRIDGE_FIRST)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("BRIDGE-RUNNING", r.stdout)

    def test_an_upgrade_that_recreated_the_bridge_prints_bridge_running(self):
        self.state(containers={"novu-bridge": self.OLD}, after_up=self.NEW)
        r = self.run_task(T_BRIDGE_FIRST)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("BRIDGE-RUNNING", r.stdout)

    def test_a_new_bridge_that_is_not_running_is_reported_and_not_bridge_running(self):
        self.state(containers={"novu-bridge": self.OLD}, after_up=dict(self.NEW, running=False))
        r = self.run_task(T_BRIDGE_FIRST)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("BRIDGE-NOT-RUNNING", r.stdout)
        self.assertNotIn("BRIDGE-RUNNING ", r.stdout)


class EarlyRemoval(Harness):
    def test_a_bridge_owning_the_topic_retires_the_senders(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}),
                   rpk_group=[GROUP_NOTHING, GROUP_NOTHING, GROUP_ASSIGNED])
        r = self.run_task(T_EARLY)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("HANDOFF ASSIGNED", r.stdout)
        self.assertIn("removed: egov-notification-sms otp-publisher", r.stdout)
        self.assertEqual(set(self.containers()), {"novu-bridge"})

    def test_committed_offsets_are_a_handoff(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_group=GROUP_COMMITTED)
        r = self.run_task(T_EARLY)
        self.assertIn("HANDOFF COMMITTED", r.stdout)
        self.assertNotIn("egov-notification-sms", self.containers())

    def test_a_group_without_offsets_or_assignment_defers_and_keeps_the_senders(self):
        # the 2.12 upgrade: the bridge's group never consumed the OTP topic
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_group=GROUP_NOTHING)
        r = self.run_task(T_EARLY)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("DEFERRED: egov-notification-sms otp-publisher", r.stdout)
        self.assertNotIn("removed:", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())
        self.assertIn("otp-publisher", self.containers())

    def test_a_dead_group_defers(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_group=GROUP_DEAD)
        r = self.run_task(T_EARLY)
        self.assertIn("DEFERRED:", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())

    def test_an_owned_topic_does_not_count_while_the_bridge_is_unhealthy(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": dict(self.NEW, health="starting")}),
                   rpk_group=GROUP_ASSIGNED)
        r = self.run_task(T_EARLY)
        self.assertIn("DEFERRED:", r.stdout)
        self.assertIn("starting", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())

    def test_half_the_partitions_is_not_a_handoff(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}),
                   rpk_topic=TOPIC_2P, rpk_group=GROUP_HALF)
        r = self.run_task(T_EARLY)
        self.assertIn("DEFERRED:", r.stdout)
        self.assertIn("1 of 2 partition(s)", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())

    def test_redpanda_that_cannot_be_asked_keeps_the_senders(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_down=True)
        r = self.run_task(T_EARLY)
        self.assertIn("DEFERRED:", r.stdout)
        self.assertIn("(UNKNOWN)", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())

    def test_a_bridge_with_core_sms_off_never_takes_over(self):
        bridge = dict(self.NEW, env={"NOVU_BRIDGE_CORE_SMS_ENABLED": "false"})
        self.state(containers=dict(self.senders(), **{"novu-bridge": bridge}), rpk_group=GROUP_ASSIGNED)
        r = self.run_task(T_EARLY)
        self.assertIn("DEFERRED:", r.stdout)
        self.assertIn("(DISABLED)", r.stdout)
        with open(self.log) as fh:
            self.assertNotIn("group describe", fh.read())  # gave up at once
        self.assertIn("egov-notification-sms", self.containers())

    def test_a_missing_topic_is_created_and_waited_for(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}),
                   rpk_topic=[TOPIC_NONE, TOPIC_1P], rpk_group=[GROUP_DEAD, GROUP_ASSIGNED])
        r = self.run_task(T_EARLY)
        with open(self.log) as fh:
            self.assertIn("exec digit-redpanda rpk topic create %s -p 1 -r 1" % TOPIC, fh.read())
        self.assertIn("removed:", r.stdout)

    def test_another_deployments_container_is_left_alone(self):
        senders = self.senders()
        senders["otp-publisher"]["workdir"] = "/srv/other"
        self.state(containers=dict(senders, **{"novu-bridge": self.NEW}))
        r = self.run_task(T_EARLY)
        self.assertIn("SKIP otp-publisher", r.stdout)
        self.assertIn("otp-publisher", self.containers())
        self.assertNotIn("egov-notification-sms", self.containers())

    def test_nothing_to_retire(self):
        self.state(containers={"novu-bridge": self.NEW})
        r = self.run_task(T_EARLY)
        self.assertIn("NOCHANGE", r.stdout)


class LateRemoval(Harness):
    def test_first_enable_retires_the_senders_once_the_bridge_owns_the_topic(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": dict(self.NEW, health="starting")}),
                   rpk_group=GROUP_ASSIGNED)
        r = self.run_task(T_LATE)  # owned, but by a bridge that never got healthy
        self.assertIn("KEPT: egov-notification-sms otp-publisher", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())
        with open(self.state_path) as fh:
            st = json.load(fh)
        st["containers"]["novu-bridge"]["health"] = "healthy"
        with open(self.state_path, "w") as fh:
            json.dump(st, fh)
        r = self.run_task(T_LATE)  # the next deploy, once it is healthy
        self.assertIn("HANDOFF ASSIGNED", r.stdout)
        self.assertEqual(set(self.containers()), {"novu-bridge"})

    def test_a_group_that_never_gets_the_topic_keeps_the_senders(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_group=GROUP_NOTHING)
        r = self.run_task(T_LATE)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("KEPT:", r.stdout)
        self.assertIn("0 of 1 partition(s)", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())
        with open(self.log) as fh:
            self.assertEqual(fh.read().count("group describe"), 60)  # 10 minutes of 10 s polls

    def test_the_late_task_runs_after_a_deferral_and_when_the_early_one_was_skipped(self):
        _, t = task_shell(T_LATE, self.digit_dir)
        cond = " ".join(str(c) for c in t["when"])
        self.assertIn("retired_notification_containers is skipped", cond)
        self.assertIn("'DEFERRED:' in (retired_notification_containers.stdout", cond)


class EnableNotificationsScript(Harness):
    """enable-notifications.sh sources the same helper; its functions run here on their own."""

    def run_fn(self, body, ccrs=REPO):
        # The whole script minus its last line (`main "$@"`), then the box's sudo and compose
        # names swapped for the fakes.
        script = textwrap.dedent("""\
            source <(sed '$d' %(enable)s)
            set +e
            DIGIT_HOME=%(d)s; DRY_RUN=false; DC="docker compose"; CCRS_HOME=%(ccrs)s
            sudo() { "$@"; }
            container_of() { docker inspect "$1" >/dev/null 2>&1 && echo "$1"; }
            %(body)s
            """) % {"d": self.digit_dir, "enable": ENABLE, "body": body, "ccrs": ccrs}
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"],
                   FAKE_STATE=self.state_path, FAKE_LOG=self.log, NO_COLOR="1")
        return subprocess.run(["/bin/bash", "-c", script], cwd=self.digit_dir, env=env,
                              capture_output=True, text=True, timeout=60)

    def test_step2_keeps_the_senders_until_the_bridge_owns_the_topic(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_group=GROUP_NOTHING)
        r = self.run_fn("_remove_retired_after_handoff 60")
        self.assertIn("LEFT RUNNING", r.stdout + r.stderr)
        self.assertIn("0 of 1 partition(s)", r.stdout + r.stderr)
        self.assertIn("egov-notification-sms", self.containers())

    def test_step2_removes_them_once_it_does(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}),
                   rpk_group=[GROUP_NOTHING, GROUP_ASSIGNED])
        r = self.run_fn("_remove_retired_after_handoff 60")
        self.assertIn("handoff ASSIGNED", r.stdout)
        self.assertEqual(set(self.containers()), {"novu-bridge"}, r.stdout + r.stderr)

    def test_without_the_helper_the_senders_are_kept(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}))
        r = self.run_fn("_remove_retired_after_handoff 60", ccrs="/nonexistent")
        self.assertIn("core-sms-handoff.sh not found", r.stdout)
        self.assertIn("egov-notification-sms", self.containers())

    def test_step1_refuses_an_old_container_left_in_place(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.OLD}))
        r = self.run_fn("_bridge_is_current && echo CURRENT || echo STALE")
        self.assertIn("STALE", r.stdout)
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}))
        r = self.run_fn("_bridge_is_current && echo CURRENT || echo STALE")
        self.assertIn("CURRENT", r.stdout)

    def test_step1_waits_five_minutes_and_leaves_the_rest_to_step2(self):
        self.state(containers=dict(self.senders(), **{"novu-bridge": self.NEW}), rpk_group=GROUP_NOTHING)
        r = self.run_fn("_remove_retired_after_handoff 30")
        self.assertIn("after 5 minute(s)", r.stdout + r.stderr)
        with open(self.log) as fh:
            self.assertEqual(fh.read().count("group describe"), 30)
        self.assertIn("egov-notification-sms", self.containers())


if __name__ == "__main__":
    unittest.main()
