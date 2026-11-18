# SMS/MMS media browser-cache isolation

The authenticated `GET /sms/media/:messageId/:idx` proxy previously returned
`Cache-Control: private, max-age=60` on success. A browser could reuse account A's
cached response after a same-browser switch to account B before the request
reached the authorization middleware. Synthetic Chrome QA reproduced this.

The correction sends `Cache-Control: private, no-store` before authentication,
including on authorization and upstream errors. The web client also includes
its current account ID in the media request's cache key, so a newly loaded
client will not request the URL cached by older releases. This query value is
only a cache partition; the server still authenticates and checks SMS-thread
ownership. Blob URLs are revoked when the attachment unmounts or its account
scope changes. The disposable SMS IndexedDB search/media-reference cache is
scoped by account and thread; upgrading it discards version-1 rows that had no
owner, and sign-out/account changes clear the prior account's rows.

Previously cached browser responses and Blob URLs in **already open old client
tabs** cannot be remotely removed. The old response lifetime was 60 seconds;
reload those tabs after release and allow that lifetime to expire. A Cloudflare
cache purge would not clear a user's private browser cache and is not required
for this specific bypass. This does not establish whether any historical
public object/CDN URL remains accessible; that is a separate storage-access
gate. No production cache purge is performed by this change.
