#!/usr/bin/env python3
"""Splice the AgentRoster component into ProviderManagerDialog.tsx,
replacing the QuickResultCard component (lines 708-834 area, found by anchors)."""
import re

path = '/home/z/my-project/src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx'
new_component = open('/home/z/my-project/scripts/agent-roster-component.tsx.txt').read()

src = open(path).read()
start_marker = '/** ⚡ Quick API Setup result — the beloved old-UI experience, all in English:'
end_marker = '\nfunction ProviderForm('

si = src.index(start_marker)
ei = src.index(end_marker)
replaced = src[:si] + new_component + src[ei + 1:]  # keep the newline before ProviderForm
open(path, 'w').write(replaced)
print('Replaced QuickResultCard with AgentRoster.')
print('Old block chars:', ei - si, '| New block chars:', len(new_component))
