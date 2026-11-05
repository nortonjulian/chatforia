# SSH key-only change — proposed for both Droplets, not applied

## Evidence and scope

Read-only [target evidence](evidence/ssh-hardening-readonly-20261105.json)
shows the same override order on `chatforia-web-01` and `chatforia-api-01`:
`sshd_config` includes `sshd_config.d/*.conf` at line 12; `50-cloud-init.conf`
sets `PasswordAuthentication yes` before `60-cloudimg-settings.conf` sets `no`;
the main file later sets `PermitRootLogin yes`. No `Match` block was found in
the active include set. Both global and current root-connection `sshd -T`
views report password authentication and root login enabled, public-key
authentication enabled, keyboard-interactive disabled and
`AuthenticationMethods any`. Both hosts accepted a fresh forced-public-key
operator login, and `ssh.service` is active. Root password status is `P` on
both hosts; this does **not** prove the owner can use the password in the
DigitalOcean Recovery Console. No key material, password hashes or password
values were printed or copied.

The current frontend GitHub Actions workflow uses an SSH private-key secret on
a standard hosted runner. The backend workflow deliberately stops before SSH.
This proposal keeps root public-key login available, including to the Actions
key; it does not narrow port 22 or alter firewall rules. The Actions secret
cannot be inspected here, so a no-op Actions connection check is required
after a separately approved reload, before the deploy workflow is trusted.

## Exact configuration diff on **each** server

Leave `/etc/ssh/sshd_config`, `50-cloud-init.conf`, `60-cloudimg-settings.conf`,
`authorized_keys` and host keys unchanged. Add only a root-owned `0644`
`/etc/ssh/sshd_config.d/00-chatforia-key-only.conf` with the exact bytes in
[the prepared template](chatforia-key-only-sshd.conf.example):

```diff
--- /dev/null
+++ /etc/ssh/sshd_config.d/00-chatforia-key-only.conf
@@
+PubkeyAuthentication yes
+PasswordAuthentication no
+KbdInteractiveAuthentication no
+AuthenticationMethods publickey
+PermitRootLogin prohibit-password
```

The `00-` file is expanded before the cloud-init files. [OpenSSH's server
configuration rules](https://man.openbsd.org/sshd_config) use the first
obtained value for these directives, so later `yes` values will not undo this
drop-in. A stdin-only `sshd -T -f /dev/stdin -C` dry parse on **both current
hosts** returned public-key authentication `yes`, password and keyboard
interactive `no`, authentication methods `publickey`, and root login
`without-password` (the server's normalized alias for `prohibit-password`).
That parse changed no file or daemon. A post-install effective check remains
mandatory because cloud-init or another include could change before approval.

## Approval-window validation, one host at a time

1. **Recovery prerequisite:** With no SSH change in progress, owner opens each
   Droplet's DigitalOcean **Settings → Recovery console**, confirms the login
   prompt and logs in with an existing owner-held root/sudo password. Do not
   send or record the password. [DigitalOcean says](https://docs.digitalocean.com/products/droplets/how-to/recovery/recovery-console/)
   this console is out-of-band but needs a password. A `P` status or merely
   seeing the launch button is insufficient. If either login fails, stop before
   changing that host; resetting a password is a separate production action.
2. Keep the verified operator SSH session open. Confirm a second fresh
   public-key-only session works and the GitHub Actions deployment key is still
   authorized for its intended account. Confirm the frontend workflow's
   `DO_HOST`/`DO_USER` resolves to the web Droplet and intended SSH user
   **without disclosing the secret values**. Do not dispatch a deploy workflow
   for this check.
3. Save a root-only copy of the current SSH config metadata and record its
   digest. Install the prepared file as root `0644` at the exact path above.
   Before reload, run `sshd -t` and `sshd -T -C` for the current root source
   and intended Actions account/source. Require `passwordauthentication no`,
   `kbdinteractiveauthentication no`, `authenticationmethods publickey`,
   `pubkeyauthentication yes`, and `permitrootlogin` equal to
   `prohibit-password` or its normalized `without-password`. If any differs,
   disable the new file without reloading and stop.

   ```sh
   install -o root -g root -m 0644 chatforia-key-only-sshd.conf.example \
     /etc/ssh/sshd_config.d/00-chatforia-key-only.conf
   sshd -t
   sshd -T -C user=root,host=OPERATOR_SOURCE,addr=OPERATOR_SOURCE,laddr=DROPLET_IP,lport=22
   ```

   `OPERATOR_SOURCE` and `DROPLET_IP` are verified values for that host; do
   not paste credentials into the command. Transfer the template from the
   reviewed release artifact before `install`.
4. Reload **`ssh.service`**, never restart it; keep the first session open.
   Prove a new forced-public-key operator login, then run a separate no-op
   GitHub Actions SSH connection using the existing deploy key/host/user
   secrets, `BatchMode=yes`, password auth disabled on the client, and an
   independently pinned host key. It must run `true` only, with no rsync,
   deployment, nginx reload or migration. Run the same no-op check for the API
   key if it remains part of the approved operator path. No repository secret
   value or private key may enter logs.

   ```sh
   ssh -i "$SSH_KEY_FILE" -o BatchMode=yes \
     -o PreferredAuthentications=publickey -o PasswordAuthentication=no \
     -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes \
     "$DO_USER@$DO_HOST" true
   ```

   In the Actions check, `SSH_KEY_FILE`, `DO_USER` and `DO_HOST` come from the
   existing protected deployment settings; configure a previously verified
   host key in `known_hosts` rather than trusting a fresh `ssh-keyscan` result.
5. Confirm the server does not offer password or keyboard-interactive login
   using a bounded SSH negotiation with no credential submission. Recheck
   `sshd -T -C` and the existing session, then record only pass/fail and
   public-key fingerprints. Proceed to the second host only after the first
   is stable.

## Abort and rollback

If syntax, effective values, operator key login, Actions key login or console
recovery fails, **do not continue to the other server or change firewalls**.
Using the held session or the already-tested Recovery Console, rename the new
file outside the `*.conf` glob, run `sshd -t`, reload `ssh.service`,
and confirm the original `sshd -T -C` values and fresh key login. Keep the
original session until that verification passes. If the console itself was
never proved, do not rely on a future password reset as a tested rollback.
Do not change `authorized_keys`, keys, root password, ports or firewall rules
as part of this change.

```sh
mv /etc/ssh/sshd_config.d/00-chatforia-key-only.conf \
  /etc/ssh/sshd_config.d/00-chatforia-key-only.conf.disabled
sshd -t
systemctl reload ssh.service
```

The proposed SSH change is distinct from the separately approved firewall,
migration exception, migration and credential cutover decisions.
