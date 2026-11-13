# Cortex Engineering Assistant

A browser bookmarklet that adds a floating toolkit panel to a Cortex XSIAM tenant. It runs entirely client-side and uses the same internal webapp API calls the XSIAM UI already makes, authenticated by your existing session cookie.

Built as a bookmarklet rather than a browser extension because enterprise policy (Prisma Access Browser) blocks unpacked extension installs.

## Install

1. Serve the folder locally:

   ```
   python3 -m http.server 8888
   ```

2. Open <http://localhost:8888/install.html>
3. Drag the **Cortex Engineering Assistant** button to your bookmarks bar
4. Navigate to your XSIAM tenant and click the bookmark

To update, re-drag the button from the install page, replacing the old bookmark.

The install page is self-contained — the bookmarklet is inlined into it, so no network calls are needed to install.

## Tabs

### Log Viewer

Reads `INTEGRATION_LOGS_TABLE`.

- Filter by integration, instance, and log level
- Non-integration sources (Automation, Playbook, Scripts) are selectable too, so automation and field-change script logs are reachable
- Free text search
- **LIVE** mode tails new entries like `tail -f`; auto-refresh at a configurable interval
- Export to JSON or CSV
- Click an entry to expand the full content

### Closer

Bulk-resolves issues or cases.

- **Issues** — searches `ALERTS_VIEW_TABLE`, closes via `alerts/update_alerts`
- **Cases** — searches `CASE_MANAGER_TABLE`; resolves a case by looking up its issue IDs (`case/get_issue_ids_in_case`) and closing those, mirroring the UI's `resolve_all_alerts` behavior
- Filter by severity, status, and name; select from results or paste IDs directly
- Resolution status and comment are prompted in a modal on submit

### Data Sources

Snapshots data source configuration across the tenant, grouped by source with instance status.

- XSOAR / XDR toggle
- Filter by data source or instance name
- Copy JSON to clipboard, or export JSON / CSV

Note: this reflects what the API returns, so sensitive configuration values (passwords, tenant IDs) are not included.

## Notes

- Everything runs in the browser against your authenticated session. No data leaves the tenant and there is no backend.
- The CSRF token is read from the `csrf_token` cookie at call time; all API paths are relative, so the tool works against whichever tenant you have open.
- These are internal, undocumented webapp endpoints. They are not covered by the public API contract and may change between XSIAM releases.

## Editing

`bookmarklet.js` is the source. After changing it, re-inline it into `install.html`:

```python
import json

with open('bookmarklet.js') as f:
    bm = ' '.join(f.read().split())
encoded = json.dumps(bm)

with open('install.html') as f:
    html = f.read()

start = html.find('<script>')
end = html.find('</script>') + len('</script>')
script = (
    '<script>\n    var BOOKMARKLET = ' + encoded + ';\n'
    '    document.getElementById("bookmarklet-link").href = BOOKMARKLET;\n'
    '    document.getElementById("bookmarklet-link").textContent = "Cortex Engineering Assistant";\n'
    '    document.getElementById("manual-code").textContent = BOOKMARKLET;\n'
    '  </script>'
)

with open('install.html', 'w') as f:
    f.write(html[:start] + script + html[end:])
```

## Credits

Data Sources tab based on a data source collection script by Daniel Spier.

---

Internal tool. Not affiliated with or endorsed by Palo Alto Networks.
