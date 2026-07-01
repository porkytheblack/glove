# Scratchpad Computer — context reduction (deterministic benchmark)

Each cell is measured by running the actual scratchpad operations (contain → narrow → JOIN → materialize)
over seeded data and reading the bytes that cross the model boundary. No model, no API key — the reduction
factor is a property of the data + workflow. Tokens are estimated at ~4 bytes/token; the factor is exact.

### Reduction vs payload size (5 providers, 100 accounts)

| rows / provider | naive (KB) | scratchpad (KB) | **reduction** | naive (est. tok) | scratchpad (est. tok) |
|---|---:|---:|:---:|---:|---:|
| 100 | 79.3 | 22.0 | **3.6×** | 20.3k | 5.6k |
| 500 | 396.1 | 22.5 | **17.6×** | 101.4k | 5.8k |
| 1000 | 792.1 | 22.6 | **35.0×** | 202.8k | 5.8k |
| 5000 | 3962.3 | 22.7 | **174.5×** | 1014.3k | 5.8k |
| 20000 | 15845.9 | 22.8 | **696.1×** | 4056.6k | 5.8k |
| 50000 | 39612.3 | 22.9 | **1731.2×** | 10140.7k | 5.9k |

### Reduction vs provider count (1,000 rows each, 100 accounts)

| providers | naive (KB) | scratchpad (KB) | **reduction** | naive (est. tok) | scratchpad (est. tok) |
|---|---:|---:|:---:|---:|---:|
| 1 | 158.4 | 4.5 | **35.4×** | 40.5k | 1.1k |
| 2 | 316.8 | 9.6 | **33.0×** | 81.1k | 2.5k |
| 3 | 475.3 | 13.9 | **34.1×** | 121.7k | 3.6k |
| 5 | 792.1 | 22.6 | **35.0×** | 202.8k | 5.8k |
| 10 | 1584.3 | 44.3 | **35.7×** | 405.6k | 11.3k |
