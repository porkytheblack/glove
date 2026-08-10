---
"glove-env-spreadsheets": patch
---

Page a big sheet in linear time instead of quadratic.

The docs tell a model to walk a large sheet with `read({ offset, limit })`. Every one of those calls re-read the file and rebuilt the whole workbook, so the loop the docs recommend cost O(rows² / limit): page 20 did exactly as much work as page 1, and doubling the sheet quadrupled the loop. Measured before, paging 5000 rows at a time (`pnpm --filter glove-env-spreadsheets bench`):

```
  25000 rows   5 pages   6.2s total   mean page 1.24s
  50000 rows  10 pages  20.3s total   mean page 2.06s
 100000 rows  20 pages  93.6s total   mean page 4.64s
```

4× the rows cost 15.2× the time, against 16× for a perfect quadratic. After:

```
  25000 rows   5 pages   0.73s total   page 1 702ms, every page after it 6ms
  50000 rows  10 pages   1.22s total   page 1 1160ms, every page after it 7ms
 100000 rows  20 pages   2.24s total   page 1 2096ms, every page after it 8ms
```

4× the rows now costs 3.1× the time, and the 100k-row loop is **41.8× faster**. Pages after the first cost 0.4% of the first, which is the shape the issue asked for: one parse, then slices.

Two changes get there, and both are needed. exceljs's streaming `WorkbookReader` replaces `wb.xlsx.load` for anything large — on the 100k-row file that alone is 2.7s and 32 MB against 4.4s and **291 MB**, because the loader keeps a live cell object per cell and the reader hands back one row at a time. And the flattened sheet is kept, so a paged loop parses once instead of once per page.

Streaming is not free below a certain size: every xlsx written by exceljs or Excel puts `sharedStrings.xml` after the sheets, and the streaming reader answers that by spooling each sheet through a temp file, a fixed ~5ms a workbook that a four-row sheet notices. The two were measured across sizes and cross at about 35 KB, so under 32 KB the full loader is still used. That is also the more faithful of the two readers, which matters for the one thing streaming genuinely loses: a shared-formula follower cell (`<f t="shared" si="0"/>`) carries no formula text at all, where the loader reports its anchor. Values are identical either way; `read({ formulas: true })` on a sheet that uses shared formulas re-reads with the loader so the reported formula text stays exact. Nothing else about the output moved — flattened formulas, stringified rich text, ISO dates, preserved error cells, column-letter fills for blank headers and `_2` suffixes for duplicates are all pinned, and the date case is now pinned against *both* readers because it is the one that actually diverges (a date is a number plus a number-format, and the streaming reader needs the style table to tell them apart).

The parsed sheets are held per environment, never per process — a cache keyed by path and shared across environments would hand one tenant's rows to another the moment two agents used the same filename, and there is a test that would fail if that changed. Every write through the adapter drops what it holds for that path, and entries carry a `size:mtime` fingerprint besides, so a read after a write always sees the new file. The budget is `cacheCells` (default 1,000,000, about 55 MB — less than one `xlsx.load` of the file in the benchmark used to allocate transiently); a workbook bigger than the whole budget is simply not held rather than evicting everything to fit.

The new reader takes bytes, never a path. `WorkbookReader` accepts a filename and would open it off the host filesystem; the only caller reads through the guarded VFS handle.
