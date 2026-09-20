# petersenmalte-homepage

Static GitHub Pages site, served under `/petersenmalte-homepage/`.

The shared terminal (`assets/console.js` and `assets/console.css`) is included on
every HTML page. Its visibility, log, command history, input draft and message
wizard persist within the current browser tab via sessionStorage, including
ordinary links and reloads. `clear` restores the page tree and help hint.
`open` supports file completion with Tab, including `/` and `./` prefixes.

`mail` collects a name, optional reply email and a message. Press Enter at the
email prompt to skip it. The optional address is included as `Reply to:` in the
notification, so the recipient can reply by email. Replies are not delivered
back into the browser terminal; that would require a separate messaging backend.

The notification endpoint does not expose its response via CORS. The browser
therefore sends a single `no-cors` request and displays `sent message.` when it
completes. This acknowledges submission, not confirmed delivery: opaque responses
hide HTTP status and response body. Network failures display a neutral error;
requests are never automatically retried.

Run tests with Node.js installed:

```sh
npm install
npx playwright install chromium
npm test
```

Tests serve the site under its actual project path and intercept all external
requests; no real notifications are sent.
