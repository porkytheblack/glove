# glove-env-unlock

## 2.0.0

### Patch Changes

- Updated dependencies [[`653c3f5`](https://github.com/porkytheblack/glove/commit/653c3f54c231675da30afe62725d53e2855261a9), [`331ce80`](https://github.com/porkytheblack/glove/commit/331ce80da3eb0a4b313311d6628a87299b209cc4)]:
  - glove-working-environment@0.7.0

## 1.0.1

### Patch Changes

- [#167](https://github.com/porkytheblack/glove/pull/167) [`bc184e9`](https://github.com/porkytheblack/glove/commit/bc184e95fb3c5f01978fa4520d825e4e1abc070c) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Add a shared `unlock(input, output, { password })` operation for password-protected
  PDFs, OOXML Word/Excel/PowerPoint documents and AES/ZipCrypto ZIP archives. Each
  file adapter exposes it and can use the resulting unencrypted VFS copy through
  its existing readers, editors, rendering and OCR paths. Preserve source files,
  refuse existing destinations, enforce output limits and suppress password values
  in decryption errors. Expose a host-side binding for passwords that must stay out
  of persisted scripts and run arguments.
- Updated dependencies [[`6a2980c`](https://github.com/porkytheblack/glove/commit/6a2980c368b2d6351310444d676c50553e148553)]:
  - glove-working-environment@0.6.1
