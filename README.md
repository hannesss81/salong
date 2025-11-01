# Vanalinna Ilusalong Website

Minimalistic modern static website for an Estonian beauty salon located in Tallinn Old Town.

## Features
- Fast static HTML/CSS/JS (no framework build step)
- Dynamic pricing from `pricing.json`
- Accessible semantic structure
- Responsive design & mobile-first CTA
- SEO meta tags + JSON-LD BeautySalon schema
- PWA manifest (service worker to be added)
- Lazy-loaded gallery images (placeholders)

## Structure
```
index.html        # Main page
styles.css        # Design system & layout
script.js         # Pricing logic & structured data injection
pricing.json      # Editable services & prices
manifest.json     # PWA manifest
robots.txt        # Basic crawler directives
assets/           # Images, icons, logo
```

## Editing Pricing
Edit `pricing.json` - each service object has:
- name (string)
- description (string)
- price (number, EUR)
- duration (minutes)
- category (string; used as filter tab)

Categories are auto-generated; keep them consistent for grouping.

## Deployment (Cloudflare Pages recommended)
1. Create a new GitHub repository and push this folder.
2. In Cloudflare dashboard: Pages -> Create Project -> Connect to repo.
3. Build settings: set framework preset to None (static). Leave build command empty; output directory `/`.
4. After first deploy, set custom domain (use Zone.ee DNS to point A record or CNAME to Cloudflare provided target).
5. Enable automatic minification (Cloudflare Speed settings) & turn on Brotli.
6. (Optional) Add a Worker route later for booking or email form.

### Domain Migration from WordPress on Zone.ee
- In Zone.ee DNS, update records to Cloudflare nameservers if using full Cloudflare; or just repoint A/CNAME if keeping Zone for DNS.
- Set 301 redirect from old WordPress URLs if structure changes (you can map via Cloudflare Page Rules).

## GitHub Pages Alternative
- Push code to `<user>.github.io` repository.
- Ensure `index.html` at root.
- Set custom domain via `CNAME` file.
- Use Cloudflare proxy for performance (optional).

## Local Development
Opening `index.html` directly with the `file://` protocol will break root-relative paths and the manifest/service worker due to browser security. Run a tiny local server:

PowerShell (Python):
```powershell
python -m http.server 8080
```
Then visit: http://localhost:8080

Or Node (if installed):
```powershell
npx serve .
```

## Adding Service Worker (future)
Create `sw.js`, register in `script.js`:
```js
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js');
}
```
Cache static assets & pricing for offline view.

## Future Improvements
See section in site planning: booking integration, multilingual toggle, analytics, forms.

## License
Proprietary – internal business use.
