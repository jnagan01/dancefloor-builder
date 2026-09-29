# VirtualDJ-native playlist export (.m3u + .txt)

## What changes for you
Each list (Warm Up, Transition, Peak) exports as two files VirtualDJ reads directly:
- **.m3u** in VirtualDJ's own playlist format, so artist, title, remix, BPM, key and file size show up right away without re-scanning.
- **.txt** plain song list, one "Artist - Title" per line (in list order), for reading or printing and for VirtualDJ's text playlist import.

The current .xml file is dropped from folder export and downloads (the .m3u replaces it). Unmatched songs are still left out of the .m3u and marked as missing in the .txt.

## Details
- .m3u layout per track, UTF-8, Windows-safe line endings:
```text
#EXTM3U
#EXTVDJ:<filesize>123</filesize><artist>A</artist><title>T</title><remix>R</remix><bpm>124</bpm><key>8A</key>
/Users/you/Music/A - T.mp3
```
  Values are XML-escaped; empty fields are omitted. A standard `#EXTINF:-1,Artist - Title` line is kept too, so other DJ apps still read it.
- File paths: absolute paths from the VirtualDJ database are written as-is. Songs found only by folder scan have relative paths; the export writes those relative to the chosen music folder, and a warning is shown if a song's full location isn't known.
- .txt: numbered in set order, extra picked files listed under their song, unmatched lines end with "(not in library)".
- Applies to: export to linked folder, single-list download, and the ZIP download.

## Technical section
- `src/lib/virtualDj.ts`: rewrite `buildM3u` to emit `#EXTVDJ` lines; add `buildTxtPlaylist(items, lib)`; keep `buildVirtualDjXml` exported but unused by export.
- `src/routes/_authenticated/events.new.tsx` (~lines 1246–1380): swap `.xml` outputs for `.txt` in folder export, downloads and ZIP; update button labels.
- Extend `tests/virtualDj.ssr.test.ts` to check `#EXTVDJ` tags, escaping, and .txt output.
