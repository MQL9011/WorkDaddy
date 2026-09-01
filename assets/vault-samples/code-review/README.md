# Vault PoC fixture: code-review

Sample plugin payload for [`assets/extensions/omp-work-vault.ts`](../../extensions/omp-work-vault.ts).
`command.md` is the plaintext trigger stub; everything under `payload/` is
AES-256-GCM ciphertext (the `CC_VAULT_V1` envelope format the extension
parses) and contains no real business content — it is placeholder text
written solely to validate the decrypt-on-demand flow end to end.

## The encryption tool is not part of this repository

The `.enc` files were produced by a separate `vault.py` CLI (AES-256-GCM,
`encrypt-dir` command) that is not checked into WorkDaddy — it is a
standalone tool the skill-content owner runs before shipping a plugin. This
repo only owns the *decryption* half (the extension) and this fixture; the
*encryption* half is explicitly out of scope for this PoC (see the vault PoC
plan).

## Regenerating this fixture

Given a `vault.py` with `encrypt-file` / `encrypt-dir` / `keygen` commands
producing the envelope above, the fixture was built with:

```bash
# 1) Plaintext source (not committed — placeholder only, written straight to /tmp)
mkdir -p /tmp/vault-fixture-src/references
# ... write SKILL.md and references/checklist.md ...

# 2) Encrypt with the key baked into electron/main/index.ts
#    (ancoderVaultPocKeyHex — PoC-only, not a real secret management story)
VAULT_KEY=<the hex key from electron/main/index.ts> \
  python3 /path/to/vault.py encrypt-dir /tmp/vault-fixture-src \
  --output assets/vault-samples/code-review/payload
```

If the key in `index.ts` ever changes, this fixture must be re-encrypted with
the new key or `vault_read` will fail with "wrong key or corrupted file".
