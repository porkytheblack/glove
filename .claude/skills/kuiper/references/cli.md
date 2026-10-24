# Kuiper CLI reference

> Every kuiper command and subcommand with what it does and the flags it takes. Copied from https://kuiper.sh/docs/cli/ — that page is authoritative if they differ.
>
> Part of the `kuiper` skill. Start from [SKILL.md](../SKILL.md).


## Conventions

Every command prints a table or a short message. Add `--json` to get the raw JSON response instead.

```sh
kuiper units --json
```

Run `kuiper --help`, or `kuiper <command> --help`, for the exact flags of your version.

### Global options

| Option | What it does |
| --- | --- |
| `--json` | Print raw JSON responses. |
| `-p`, `--project SLUG` | The project to act on. Defaults to the project set with `kuiper use`, or `KUIPER_PROJECT`. |
| `-e`, `--environment NAME` | The environment of the project: `production`, `staging`… Defaults to the one `kuiper use` remembered, or `KUIPER_ENVIRONMENT`, else production. A project slug such as `proxima-staging` works without it. |
| `-u`, `--unit SLUG` | The unit to act on. Defaults to `web`. |
| `-V`, `--version` | Print the CLI's version. |
| `-h`, `--help` | Print help. |

`-p`, `-e` and `-u` work before or after a nested subcommand, so `kuiper env set -u agent NAME=value` and `kuiper env -u agent set NAME=value` are the same. Commands that act on a whole project take `-p` only. Commands that act on one unit take `-p` and `-u`.

### Environment

| Variable | What it does |
| --- | --- |
| `KUIPER_API_URL` | The instance to talk to. Overrides the config file. |
| `KUIPER_TOKEN` | The API token. Overrides the config file. |
| `KUIPER_PROJECT` | The default project, the same as `-p`. |
| `KUIPER_ENVIRONMENT` | The default environment, the same as `-e`. |
| `XDG_CONFIG_HOME` | Where the config file lives. The default is `~/.config`. |

The config file is `kuiper/config.json` in that directory. It holds the API URL, the token, the default project and its environment, and is readable only by you.

## Sign in and projects

| Command | What it does |
| --- | --- |
| `kuiper login` | Sign in and store the API URL and token. Opens the dashboard in your browser to approve a short code. |
| `kuiper login --no-browser` | Print the link to approve instead of opening a browser. |
| `kuiper login --token kpr_…` | Sign in with an API token. Without `--token` the token is read from standard input. |
| `kuiper login --api-url URL` | Sign in to a specific instance, such as a self-hosted one. The default is the saved instance, else `https://app.kuiper.sh`. |
| `kuiper login --browser` | Use the browser flow even when standard input is not a terminal. |
| `kuiper config show` | Show the saved settings. The token is never printed. |
| `kuiper config set api-url URL` | Point the CLI at another instance. A saved token for a different instance is dropped; one for the same instance is kept. The install script runs this for you. |
| `kuiper whoami` | Show the organisation the CLI is signed in to. |
| `kuiper use SLUG` | Set the default project. `-e NAME` sets its default environment too. |
| `kuiper projects` | List projects, with their environments. The same as `kuiper projects list`. `--all` lists every environment as a row. |
| `kuiper projects create NAME` | Create a project. `--name DISPLAY` sets a display name when the first argument should stay the slug. |
| `kuiper projects delete SLUG` | Delete a project. A project with environments needs `--with-environments`. |

## Environments

An environment is a copy of a project that runs on its own, from its own branch. See [Environments](https://kuiper.sh/docs/environments/).

| Command | What it does |
| --- | --- |
| `kuiper environments` | List the project's environments with their branch and status. The same as `kuiper environments list`, and `kuiper envs` is short for `kuiper environments`. |
| `kuiper environments create NAME` | Create an environment by copying another. |
| `kuiper environments delete NAME` | Delete an environment, its databases and their data. Asks first. |
| `kuiper environments diff NAME` | Show what differs between an environment and another. |
| `kuiper environments sync NAME` | Bring differences from another environment into this one. |

`kuiper environments create` takes `--from ENV` (default `production`), `--branch BRANCH` for the branch its units build from, `--no-secrets` to leave secret values out and `--no-deploy` to start nothing.

`kuiper environments delete` takes `--yes` to skip the question.

`kuiper environments diff` takes `--from ENV` (default `production`). It never prints secret values. With `--json` it lists each difference with the key `sync` uses to name it.

`kuiper environments sync` takes `--from ENV`, `--yes`, `--secrets` to copy secrets the target lacks, `--prune` to remove what only the target has, and `--include KEY,…` to sync only the named items: `variable:web/LOG_LEVEL`, `unit:worker`, `secret:API_KEY`, or `kind:*` for all of a kind.

## Units

| Command | What it does |
| --- | --- |
| `kuiper units` | List units. The same as `kuiper units list`. |
| `kuiper units create SLUG` | Create a unit. `--kind agent\|station\|service`, `--placement`, `--class`. |
| `kuiper units delete SLUG` | Delete a unit. |
| `kuiper status` | Show a unit's state, address, live deployment and placements. |
| `kuiper outputs` | List the outputs a unit exports, such as `INTERNAL_URL`, and the reference for each. |
| `kuiper settings` | Show or change a unit's build and run settings. They apply from the next build. |
| `kuiper dashboard` | Show a Station or Foundry unit's web dashboard, turn it on or off, or change its login. |

`kuiper settings` takes `--root-dir`, `--install-command`, `--build-command`, `--start-command`, `--port` (`0` clears it) and `--dashboard-url`. An empty value clears a setting.

`kuiper dashboard` takes `--enable`, `--disable`, `--username NAME` and `--password -|generate|VALUE`.

## Deploy and build

| Command | What it does |
| --- | --- |
| `kuiper deploy --source DIR` | Build and deploy a directory, with no repository. |
| `kuiper deploy --image IMAGE` | Deploy an existing image with its `kuiper.json`. |
| `kuiper link` | Link a Git repository to a unit, so a push builds and deploys. |
| `kuiper build` | Queue a build of the linked repository. |
| `kuiper builds` | List a unit's builds. |
| `kuiper manifest validate [PATH]` | Check a `kuiper.json`. Offline. |
| `kuiper manifest schema` | Print the JSON Schema for `kuiper.json`. Offline. |
| `kuiper manifest init [DIR]` | Write the `kuiper.json` the builder would infer for a Foundry or Station app. Offline. |

`kuiper deploy` takes `--source DIR` or `--image IMAGE`, one of them, plus `--manifest PATH` (default `kuiper.json`) and `--wait`, which waits until the deployment is live or fails.

`kuiper link` takes `--repo URL`, `--branch` (default `main`), `--root-dir` (default `.`), `--build-env NAME=VALUE` (repeat it), and `--credential NAME`.

`kuiper build` takes `--ref REF` and `--no-deploy`.

`kuiper manifest init` takes `--station` or `--foundry`, `--out PATH` (default `kuiper.json`) and `--force`.

## Deployments and operations

| Command | What it does |
| --- | --- |
| `kuiper deployments` | List a unit's deployments. |
| `kuiper deployment ID` | Show one deployment, including its resolved environment with secrets masked. |
| `kuiper rollback DEPLOYMENT` | Redeploy a previous deployment's image and manifest. |
| `kuiper restart` | Apply pending variable and secret changes. Restarts at a turn boundary. |
| `kuiper logs` | Print a unit's logs. `--tail N` (default 200), `-f` to follow, `--deployment ID` for an earlier deployment, `-q FILTER` (`--filter`) to print only the lines that match. See [Finding things](https://kuiper.sh/docs/finding/#the-filter-language). |
| `kuiper search QUERY` | Find units, deployments (by ID, commit SHA, message or branch), domains, variable and secret names, databases, buckets and activity in the project. Without a project it searches the whole organisation. `--org` searches the organisation even when a project is set, and `--limit N` sets how many results each group shows. |
| `kuiper events` | Print the project's activity feed. |
| `kuiper usage` | Show the organisation's spend this month by resource and project, with month to date and the projected month end. `--month YYYY-MM`, `--from DATE --to DATE`. With `-p`, one project's reserved and used CPU and memory and its spend. See [Usage and billing](https://kuiper.sh/docs/usage/). |
| `kuiper budgets` | List the organisation's monthly budgets with what each scope has committed. `create --scope org\|project\|key --limit USD` (`-p`, `--key gk_…`, `--action block\|notify`, `--notify-at 50,80,100`), `set ID`, `delete ID`. A `block` budget refuses new browser sessions and sandboxes once used up. |
| `kuiper volumes` | List the project's persistent volumes. |
| `kuiper regions` | List the fleet's regions and their capacity. |
| `kuiper move` | Move a unit to another region or node. `--region`, `--node`, `--force`. |
| `kuiper migrations` | List the moves of a unit that carried its volumes, newest first. |

`--force` on `kuiper move` moves a unit that has a volume without copying the data first.

## Network logs

| Command | What it does |
| --- | --- |
| `kuiper network http` | Print the requests the edge answered for the project's units. |
| `kuiper network dns` | Print the names the units' containers looked up. |
| `kuiper network flows` | Print the connections the units opened or accepted. |
| `kuiper network summary` | Show whether a unit is healthy: requests, errors, latency, busiest paths, clients and destinations. |

`http`, `dns` and `flows` take `-u UNIT` (default: every unit), `-q FILTER` (also `--filter`), `--since DURATION` (default `1h`; `15m`, `6h`, `7d` or a time), `--until`, `--limit N` (default 100) and `-f` to follow. They print oldest first; with `--json` they print the response, or one object per line when following. `summary` takes `-u UNIT` and `--window` (`1m` to `7d`, default `1h`).

The filter is the dashboard's: `@status:5xx`, `@path:/api/*`, `-@method:OPTIONS`, `@duration:>1s`, and plain words. [Network logs](https://kuiper.sh/docs/network/) lists the keys and what is recorded.

## Variables and secrets

| Command | What it does |
| --- | --- |
| `kuiper env list` | List a unit's variables with their templates. |
| `kuiper env set NAME=TEMPLATE…` | Set variables. Run `kuiper restart` to apply them. |
| `kuiper env unset NAME…` | Remove variables. |
| `kuiper secrets list` | List the project's secrets. Values are never shown. |
| `kuiper secrets set NAME=VALUE…` | Set secrets. `NAME=-` reads the value from standard input. |
| `kuiper secrets rm NAME…` | Remove secrets. |
| `kuiper shared list` | List the project's shared variables. |
| `kuiper shared set NAME=VALUE…` | Set shared variables. `NAME=-` reads the value from standard input. |
| `kuiper shared rm NAME…` | Remove shared variables. |
| `kuiper resources list` | List external resources and their outputs. |
| `kuiper resources add SLUG OUTPUT=VALUE…` | Add an external resource. `--secret OUTPUT` marks an output as secret. |
| `kuiper resources rename SLUG NEW_SLUG` | Rename an external resource. Templates are rewritten. |
| `kuiper resources rm SLUG` | Remove an external resource. |

## Databases and buckets

| Command | What it does |
| --- | --- |
| `kuiper db list` | List the project's managed databases. |
| `kuiper db create ENGINE SLUG` | Create a database. `ENGINE` is `postgres` or `redis`. `--size small\|medium\|large`, `--version`. |
| `kuiper db show SLUG` | Show one database. |
| `kuiper db credentials SLUG` | Print the database's connection values, masked. `--reveal` shows them. |
| `kuiper db restart SLUG` | Restart a database with its pinned image and existing data. |
| `kuiper db rotate-password SLUG` | Give a database a new password. It restarts with it, and so do the units that use its outputs. The old password stops working. |
| `kuiper db public SLUG` | Show a database's public access. `--on` turns it on, or changes who may connect, with `--allow CIDR` per address or range (none: any address). `--off` turns it off. |
| `kuiper db delete SLUG --confirm SLUG` | Permanently delete a database and its volume. |
| `kuiper buckets list` | List buckets. |
| `kuiper buckets create SLUG` | Create a bucket. |
| `kuiper buckets show SLUG` | Show one bucket. |
| `kuiper buckets credentials SLUG` | Print the bucket's access values, masked. `--reveal` shows them. |
| `kuiper buckets delete SLUG --confirm SLUG` | Delete an empty bucket that no variable references. |
| `kuiper buckets cors SLUG` | Show which websites may use the bucket from a browser. `--origin URL` (repeatable, or `*`) sets them, `--uploads` also allows uploads and deletes, and `--off` removes browser access. |

## Domains

| Command | What it does |
| --- | --- |
| `kuiper domains list` | List every hostname of the project with its status and certificate. The alias is `ls`. |
| `kuiper domains add HOSTNAME` | Add a domain and print the DNS records to create. `-u UNIT`, `--redirect-to HOST`, `--www`. |
| `kuiper domains inspect HOSTNAME` | Show a domain's status, what DNS says and the records to create. |
| `kuiper domains verify HOSTNAME` | Check DNS now. `--wait` keeps checking, and `--timeout SECONDS` (default 600) gives up. |
| `kuiper domains claim HOSTNAME` | Move a domain from another project into this one. Needs its TXT record. `-u UNIT`, `--redirect-to HOST`. |
| `kuiper domains set HOSTNAME` | Serve a different unit with `-u`, or redirect with `--redirect-to HOST`. `--redirect-to none` serves the unit again. |
| `kuiper domains rm HOSTNAME` | Remove a domain. The alias is `remove`. |

## Station

| Command | What it does |
| --- | --- |
| `kuiper station keys` | List a Station unit's API keys and the project secret each one is kept in. |
| `kuiper station create-key NAME` | Create a key for another service. It is printed once. `--scope read,trigger,cancel,admin,execution,registry` (comma-separated or repeated), `--no-secret`. |
| `kuiper station revoke-key ID` | Revoke a key. Its secret is removed too, unless a variable still references it. |

## Models

| Command | What it does |
| --- | --- |
| `kuiper providers list` | List the organisation's provider keys: service, name, kind, the key's last four characters, projects, status and last use. `--service models\|browsers\|sandboxes`. |
| `kuiper providers kinds` | The kinds of key you can add and their settings. `--service`. |
| `kuiper providers add KIND` | Add a provider key: `openai`, `anthropic`, `google`, `kimi`, `bedrock`, `custom` and the rest; models are `NAME/<model>`. `--key -` (read from standard input), `--name` (default the kind; `custom` needs one), `--field name=value` for a kind's settings (`region=china`, `base_url=https://…`), `--projects a,b` (default every project). Owners and admins only. |
| `kuiper providers set NAME` | Change a provider key: `--key -`, `--field name=value` (`name=` removes a setting), `--rename NEW`. |
| `kuiper providers projects NAME` | Show or change which projects may use a key: `a,b`, or `--all`. |
| `kuiper providers rm NAME` | Remove a provider key; calls to its models fail from then on. `--yes`. The alias is `remove`. |
| `kuiper providers test NAME` | Check the key with its provider: `ok`, `invalid` (the provider refused it) or `unreachable`. |
| `kuiper models list` | The models the project's provider keys offer, as `name/model`. |
| `kuiper models calls` | The project's model calls, newest first. `--unit`, `--key`, `--model`, `--provider`, `--status ok\|error\|429`, `--conversation KEY`, `--has tool_calls,images,audio,reasoning,errors`, `--since 1h`, `--until`, `--limit 50`, `--cursor`. |
| `kuiper models call ID` | One call: model and provider, status and error, tokens, timings, estimated cost, and for a logged call its messages, tool calls and results. `--json` for the call and its trace as JSON, `--raw` for the request and answer as they were sent. |
| `kuiper models usage` | Calls, tokens and estimated provider cost, `--by model\|unit\|key\|provider\|day`, over the last 30 days or `--from`/`--to`. |
| `kuiper models logging [full\|metadata]` | Show or set whether the project's calls keep their request, answer and trace, and with `--retention DAYS` (1 to 30) for how long. Owners and admins set it. |

## Browsers and sandboxes

| Command | What it does |
| --- | --- |
| `kuiper browsers sessions` | List the project's live browser sessions and their history, with what each cost for owners and admins. `--live`. |
| `kuiper browsers release ID` | Release a live browser session, or a hibernated one (its saved state goes). |
| `kuiper browsers recording ID` | A recorded session's rrweb events, one JSON array, to standard output or `--output FILE`: `kuiper browsers recording ID > session.json`. Owners and admins only. |
| `kuiper sandboxes list` | List the project's live sandboxes and their history, with where each runs and what each cost for owners and admins (`by provider` for those at your own provider). `--live`. |
| `kuiper sandboxes provider [NAME]` | Say where the project's new sandboxes run, and the organisation's sandbox provider keys it may choose. `NAME` chooses one of them; `kuiper` goes back to Kuiper's own. Choosing is for owners and admins. |
| `kuiper sandboxes release ID` | Release a live sandbox, or a hibernated one (its saved files go). |
| `kuiper sandboxes create` | Create a remote sandbox and print its ID. `--image kuiper/coding`, `--size small`, `--timeout 30m`, `--inactivity-timeout 10m`, `--hibernate-when-idle`, `--env KEY=VALUE`, `--metadata key=value`, `--port 5173` (private), `--public-port 3000`, `--provider NAME` (one of the organisation's sandbox provider keys, or `kuiper`), `--recipe STEP` (Railway's template steps). |
| `kuiper sandboxes exec ID -- CMD…` | Run a command in a sandbox; its output streams as it comes and its exit status is the CLI's. One argument is a shell line. `--cwd`, `--env KEY=VALUE`, `--user`, `--timeout 10m`, `--background`. |
| `kuiper sandboxes shell ID [-- CMD…]` | A terminal in a sandbox: bash (or sh), or the command after `--`. Your keys go to the sandbox as typed, the window's size follows yours, and the command's exit status is the CLI's. `--cwd`, `--env KEY=VALUE`, `--user`, `--no-tty` (plain pipes, the default when standard input isn't a terminal). |
| `kuiper sandboxes cp FROM TO` | Copy a file into a sandbox (`cp ./a.txt ID:/workspace/a.txt`) or out of one (`cp ID:/workspace/out.log ./out.log`). Up to 100 MB. |
| `kuiper sandboxes files ID [PATH]` | List a directory of a sandbox (default `/workspace`, or the provider's working directory). |
| `kuiper sandboxes expose ID PORT` | Serve a port of a sandbox at its own address and print the URL. `--public` for anyone with the URL; a private port's URL carries a token. |
| `kuiper sandboxes extend ID --timeout 30m` | Keep a live sandbox longer: it lives at least that much more from now, within the longest timeout. Its end never moves earlier. |
| `kuiper sandboxes hibernate ID` | Save a sandbox's workspace and stop paying for it. Running processes are not kept. |
| `kuiper sandboxes resume ID` | Bring a hibernated sandbox back with the same ID and its files. |
| `kuiper sandbox images` | List Kuiper's [sandbox images](https://kuiper.sh/docs/sandbox-images/), which a unit starts as `kuiper/<name>`: name, version, whether it is pinned and what it is for. `--json` adds what each contains and the image it resolves to. |

`create`, `exec`, `shell`, `cp`, `files`, `expose`, `extend`, `hibernate` and `resume` use the gateway's sandbox API, so they need a gateway key with the `sandboxes` service: `--key kgw_…` or `KUIPER_GATEWAY_KEY` (create one with `kuiper keys create NAME --services sandboxes`). The CLI asks the control plane where the API is; `--sandboxes-url` (or `KUIPER_SANDBOXES_URL`) names another gateway, such as `https://gateway.eu-fsn.kuiper.sh/sandboxes`.

## Inbox

A mailbox is its ID, its address or its prefix. See [Inbox](https://kuiper.sh/docs/inbox/).

| Command | What it does |
| --- | --- |
| `kuiper inbox list` | List the project's mailboxes with their unread counts and webhooks. |
| `kuiper inbox create PREFIX` | Make a mailbox: on Kuiper's domain its address is the prefix, `+` and eight digits. `--domain` (one of the project's verified domains), `--display-name`, `--webhook` (`unit://UNIT[:PORT][/PATH]` or an `https://` URL). It prints the address, and the webhook secret once. |
| `kuiper inbox update MAILBOX` | Change `--display-name` or `--webhook`; `--webhook ""` removes it. |
| `kuiper inbox secret MAILBOX` | A new webhook secret, printed once. The old one stops working. |
| `kuiper inbox rm MAILBOX` | Delete a mailbox and all its mail. |
| `kuiper inbox messages MAILBOX` | List its messages, newest first. `--unread`, `--search WORDS`, `--limit`. |
| `kuiper inbox read MESSAGE` | Show a message: its headers, its text and its attachments. Marks it read. |
| `kuiper inbox send MAILBOX --to ADDR` | Send. `--cc`, `--bcc`, `--subject`, `--text`, `--text-file` (else standard input), `--html-file`, `--attach FILE` (repeat for more). `--preview` shows what would be sent and sends nothing. |
| `kuiper inbox reply MESSAGE` | Answer in its thread. `--text`, `--text-file`, `--html-file`, `--all`, `--attach FILE`, `--preview`. |
| `kuiper inbox attachment MESSAGE INDEX` | Save an attachment, to `-o FILE` or a file named after it. |
| `kuiper inbox raw MESSAGE` | Print a message's source, or save it with `-o FILE`. |
| `kuiper inbox domains` | List the project's mail domains. `add DOMAIN` prints the DNS records it needs, `check DOMAIN` checks them now, `rm DOMAIN` removes it. |

## Registries, Git and tokens

| Command | What it does |
| --- | --- |
| `kuiper registry list` | List the project's registry credentials. |
| `kuiper registry add REGISTRY` | Add or replace credentials for a registry host. `--username` is required. The password is read from standard input unless you pass `--password`. |
| `kuiper registry rm REGISTRY` | Remove credentials for a registry. |
| `kuiper git list` | List the credentials your organisation can build with. |
| `kuiper git add-token NAME` | Add a personal access token. `--token`, `--host` (default `github.com`), `--username`. The token is read from standard input unless you pass `--token`. |
| `kuiper git rm NAME` | Remove a credential. |
| `kuiper git github` | Say whether the GitHub App is available. Connect it from the dashboard. |
| `kuiper tokens list` | List the organisation's API tokens, revoked ones included. `*` marks the one in use. |
| `kuiper tokens create NAME` | Create an API token. It is printed once. |
| `kuiper tokens revoke ID` | Revoke a token. The organisation's last active token cannot be revoked. |
| `kuiper keys list` | List the project's gateway keys (`kgw_…`) with their prefix, revoked ones included. |
| `kuiper keys create NAME` | Create a gateway key for models, browsers, sandboxes and the inbox outside Kuiper. It is printed once. `--services browsers,sandboxes,models,inbox` (default all four), `--expires 30d`. Owners and admins only. |
| `kuiper keys revoke ID` | Revoke a gateway key. Gateways refuse it within seconds. |
