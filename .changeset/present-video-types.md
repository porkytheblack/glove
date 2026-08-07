---
"glove-working-environment": patch
---

`present` labels video and audio deliverables correctly

`env:motion` renders `.mp4` and `.webm`, and `present` was handing both to the host as `application/octet-stream` — the media type a host uses to decide between a player and a download prompt. Video (`mp4`, `webm`, `mov`, `mkv`) and audio (`mp3`, `wav`, `m4a`, `ogg`) now resolve to their real types, alongside the document and image entries that were already there.
