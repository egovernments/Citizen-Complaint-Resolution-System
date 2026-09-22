# ansible.cfg sets `executable = /bin/bash` so that `set -o pipefail` works on
# Debian/Ubuntu targets, where /bin/sh is dash. Ansible derives the shell PLUGIN
# name from that basename and ships no plugin called "bash", so anything that
# loads the plugin by name — ansible.posix.synchronize does — fails with
# "Could not find the shell plugin required (bash)".
#
# bash is POSIX sh for every purpose these plugins serve (quoting, tmpdir,
# command building), so alias it.
from __future__ import annotations
from ansible.plugins.shell.sh import ShellModule as ShModule

DOCUMENTATION = '''
name: bash
short_description: bash shell, aliased to the POSIX sh plugin
description:
  - Alias so that `executable = /bin/bash` resolves to a real shell plugin.
version_added: historical
extends_documentation_fragment:
  - shell_common
'''


class ShellModule(ShModule):
    COMPATIBLE_SHELLS = frozenset(('sh', 'bash'))
    SHELL_FAMILY = 'sh'
