Run the "code-review" skill. Its content is encrypted at rest:

1. Call `vault_read` with `file: "SKILL.md"` to load the skill body.
2. Follow its instructions exactly, including any further `vault_read` calls
   it tells you to make for reference files (paths are always relative, without
   the `.enc` suffix).
3. Never try to read the underlying `.enc` files with the ordinary file tool —
   they are ciphertext and only `vault_read` can decrypt them.
