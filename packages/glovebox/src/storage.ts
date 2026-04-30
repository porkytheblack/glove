/**
 * Wrap-time storage policy DSL.
 *
 * Usage:
 *
 *     storage: {
 *       inputs:  composite([rule.url(), rule.s3({ bucket: "in" })]),
 *       outputs: composite([
 *         rule.inline({ below: "1MB" }),
 *         rule.localServer({ ttl: "1h" }),
 *       ]),
 *     }
 */

import type { StoragePolicyEncoded } from "./protocol"

type Rule = StoragePolicyEncoded["rules"][number]

export interface InlineOptions {
  below?: string
  above?: string
}

export interface LocalServerOptions {
  ttl?: string
  below?: string
  above?: string
}

export interface S3Options {
  bucket: string
  region?: string
  prefix?: string
  below?: string
  above?: string
}

export interface UrlOptions {
  below?: string
  above?: string
}

function whenFromBounds(opts: { below?: string; above?: string } | undefined, fallbackDefault: boolean): Rule["when"] {
  const when: Rule["when"] = {}
  if (opts?.above) when.sizeAbove = opts.above
  if (opts?.below) when.sizeBelow = opts.below
  if (!when.sizeAbove && !when.sizeBelow) {
    if (fallbackDefault) when.default = true
    else when.always = true
  }
  return when
}

export const rule = {
  inline: (opts?: InlineOptions): Rule => ({
    use: { adapter: "inline" },
    when: whenFromBounds(opts, true),
  }),
  localServer: (opts?: LocalServerOptions): Rule => ({
    use: { adapter: "localServer", options: { ttl: opts?.ttl ?? "1h" } },
    when: whenFromBounds(opts, true),
  }),
  s3: (opts: S3Options): Rule => ({
    use: {
      adapter: "s3",
      options: { bucket: opts.bucket, region: opts.region, prefix: opts.prefix },
    },
    when: whenFromBounds(opts, false),
  }),
  url: (opts?: UrlOptions): Rule => ({
    use: { adapter: "url" },
    when: whenFromBounds(opts, false),
  }),
}

/** Combine ordered rules into a storage policy. Earlier rules take priority. */
export function composite(rules: Rule[]): StoragePolicyEncoded {
  if (rules.length === 0) {
    throw new Error("composite() requires at least one rule")
  }
  return { rules }
}
