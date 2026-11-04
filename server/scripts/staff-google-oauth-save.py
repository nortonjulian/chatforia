import getpass,json,os,re,stat,sys
from pathlib import Path
if not sys.stdin.isatty():
    raise SystemExit('Run this command directly in an interactive local Terminal; input is never accepted from a pipe.')
folder=Path('/private/tmp') / ('chatforia-dev-oauth-'+str(os.getuid()))
try: folder.mkdir(mode=0o700)
except FileExistsError: pass
info=folder.lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700:
    raise SystemExit('Credential directory must be an owner-only directory, without symlinks.')
path=folder/'dev-client.json'
if path.exists() or path.is_symlink():
    raise SystemExit('File already exists; preserved without overwrite: '+str(path))
client_id=getpass.getpass('Chatforia Web (Dev) client ID (hidden): ').strip()
secret=getpass.getpass('Chatforia Web (Dev) client secret (hidden): ').strip()
confirmation=getpass.getpass('Confirm client secret (hidden): ').strip()
email=getpass.getpass('Google account email you will sign in with (hidden): ').strip().lower()
if not re.fullmatch(r'[A-Za-z0-9._-]+\.apps\.googleusercontent\.com',client_id):
    raise SystemExit('Client ID format was not recognized; nothing saved.')
if not secret or secret!=confirmation or any(c.isspace() for c in secret):
    raise SystemExit('Secret confirmation failed; nothing saved.')
if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email):
    raise SystemExit('Email format was not recognized; nothing saved.')
fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as output:
    json.dump({'project_id':'chatforia-dev','client_name':'Chatforia Web (Dev)','client_id':client_id,'client_secret':secret,'qa_email':email,'redirect_uri':'http://localhost:5002/auth/google/callback'},output)
    output.flush();os.fsync(output.fileno())
if stat.S_IMODE(path.stat().st_mode)!=0o600: raise SystemExit('Unexpected file permissions; stop.')
print('Saved with directory 0700 / file 0600: '+str(path))
