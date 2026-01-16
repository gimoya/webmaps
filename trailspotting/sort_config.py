#!/usr/bin/env python3
import re, sys

content = open('config.js', 'r', encoding='utf-8').read()

# Find ROUTE_CONFIG start
config_start = content.find('const ROUTE_CONFIG = {')
if config_start == -1:
    sys.exit(0)

# Find opening brace
brace_start = content.find('{', config_start)
if brace_start == -1:
    sys.exit(0)

# Find matching closing brace
depth = 1
pos = brace_start + 1
while pos < len(content) and depth > 0:
    if content[pos] == '{':
        depth += 1
    elif content[pos] == '}':
        depth -= 1
    pos += 1

if depth != 0:
    sys.exit(0)

# Extract sections
before = content[:brace_start + 1]
config_body = content[brace_start + 1:pos - 1]
after = content[pos - 1:]

# Extract entries with proper brace matching
entries = {}
pos = 0
while pos < len(config_body):
    # Skip whitespace
    while pos < len(config_body) and config_body[pos] in ' \t\n\r':
        pos += 1
    if pos >= len(config_body):
        break
    
    match = re.search(r"'([A-Z])':\s*\{", config_body[pos:])
    if not match:
        break
    key = match.group(1)
    start = pos + match.start()
    brace_pos = pos + match.end() - 1
    
    # Find matching closing brace
    depth = 1
    i = brace_pos + 1
    while i < len(config_body) and depth > 0:
        if config_body[i] == '{': depth += 1
        elif config_body[i] == '}': depth -= 1
        i += 1
    
    # Extract entry (including closing brace)
    entry_text = config_body[start:i]
    entries[key] = entry_text
    pos = i

# Sort and rebuild with proper formatting
if entries:
    sorted_entries = []
    for i, key in enumerate(sorted(entries.keys())):
        entry = entries[key]
        sorted_entries.append(entry)
        if i < len(entries) - 1:
            sorted_entries.append(',')
    
    sorted_config = before + '\n\t' + '\n\t'.join(sorted_entries) + '\n' + after
    if sorted_config != content:
        open('config.js', 'w', encoding='utf-8').write(sorted_config)
