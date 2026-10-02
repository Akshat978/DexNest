#!/bin/sh
# Synthetic repositories for the integration screenshots. Temp folder only.
set -e
W=${1:?work dir}
rm -rf "$W"; mkdir -p "$W/code" "$W/origins"
export GIT_AUTHOR_NAME="Sam Rivera" GIT_AUTHOR_EMAIL="sam@example.com" GIT_COMMITTER_NAME="Sam Rivera" GIT_COMMITTER_EMAIL="sam@example.com"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
g() { git -c init.defaultBranch=main -c commit.gpgsign=false "$@"; }
commit() { d="$1"; shift; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" g commit -q -m "$*"; }
mk() { # name days-ago-list...
  n=$1; shift
  g init -q --bare "$W/origins/$n.git"
  g clone -q "$W/origins/$n.git" "$W/code/$n" 2>/dev/null
}
day() { date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ; }

# 1. shop-web: React + TypeScript, 2 unpushed commits, uncommitted changes, a stash, a feature branch
mk shop-web; cd "$W/code/shop-web"
cat > package.json <<J
{ "name": "shop-web", "private": true, "packageManager": "pnpm@9.15.0",
  "scripts": { "dev": "vite --port 5173", "build": "tsc -b && vite build", "test": "vitest run", "typecheck": "tsc --noEmit", "deploy": "wrangler deploy" },
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0", "zustand": "^5.0.0" },
  "devDependencies": { "typescript": "^5.8.0", "vite": "^6.2.0", "vitest": "^3.0.0", "@vitejs/plugin-react": "^4.3.0", "tailwindcss": "^3.4.0" } }
J
mkdir -p src; echo 'export const App = () => null;' > src/App.tsx; echo '{}' > tsconfig.json; touch pnpm-lock.yaml
g add -A; commit "$(day 200)" "scaffold shop with vite and react"
for i in 1 2 3 4 5 6; do echo "export const v$i = $i;" >> src/cart.ts; g add -A; commit "$(day $((180 - i*25)))" "cart: step $i"; done
g push -q origin main
echo "export const checkout = true;" > src/checkout.ts; g add -A; commit "$(day 2)" "checkout: first pass"
echo "export const coupon = true;" > src/coupon.ts; g add -A; commit "$(day 1)" "checkout: coupons"
g branch -q feature/search
echo "// wip" >> src/App.tsx; echo "draft" > NOTES.md; echo "export const x = 1;" >> src/cart.ts; g add src/cart.ts
echo "temp" > scratch.txt; g stash push -q -u -m "try a new header" -- scratch.txt
# 2. api-server: Node + Express, behind origin by 3 (a teammate pushed)
mk api-server; cd "$W/code/api-server"
cat > package.json <<J
{ "name": "api-server", "scripts": { "start": "node dist/server.js", "dev": "tsx watch src/server.ts", "build": "tsc", "test": "node --test" },
  "dependencies": { "express": "^4.21.0", "pg": "^8.13.0", "zod": "^3.24.0" }, "devDependencies": { "typescript": "^5.8.0", "tsx": "^4.19.0" } }
J
mkdir -p src; echo 'console.log("api")' > src/server.ts; g add -A; commit "$(day 120)" "express api skeleton"
for i in 1 2 3; do echo "// route $i" >> src/server.ts; g add -A; commit "$(day $((100 - i*20)))" "routes: orders $i"; done
g push -q origin main
g clone -q "$W/origins/api-server.git" "$W/teammate" 2>/dev/null; cd "$W/teammate"
for i in 1 2 3; do echo "// fix $i" >> src/server.ts; g add -A; commit "$(day $((5 - i)))" "fix: pagination $i"; done
g push -q origin main; cd "$W/code/api-server"; g fetch -q origin; rm -rf "$W/teammate"
# 3. ml-notebooks: Python, clean and pushed
mk ml-notebooks; cd "$W/code/ml-notebooks"
printf '[project]\nname = "ml-notebooks"\ndependencies = ["numpy", "pandas", "scikit-learn", "matplotlib"]\n' > pyproject.toml
echo "import numpy as np" > train.py; g add -A; commit "$(day 60)" "baseline model"
echo "import pandas as pd" >> train.py; g add -A; commit "$(day 20)" "feature engineering"
g push -q origin main
# 4. infra-scripts: no remote at all
mkdir -p "$W/code/infra-scripts"; cd "$W/code/infra-scripts"; g init -q
printf 'FROM node:22-alpine\n' > Dockerfile; printf 'services:\n  db:\n    image: postgres:16\n' > docker-compose.yml
g add -A; commit "$(day 30)" "compose for local postgres"
# 5. legacy-blog: stale, merged branch, old
mk legacy-blog; cd "$W/code/legacy-blog"
printf '{ "name": "legacy-blog", "scripts": { "dev": "next dev", "build": "next build" }, "dependencies": { "next": "^12.0.0", "react": "^17.0.0" } }\n' > package.json
g add -A; commit "$(day 400)" "blog on next 12"
g checkout -q -b old/experiment; echo "x" > exp.md; g add -A; commit "$(day 390)" "try mdx"; g checkout -q main; g merge -q --no-ff -m "merge mdx experiment" old/experiment
g push -q origin main old/experiment
# 6. rust-cli: Rust, pushed, recent
mk rust-cli; cd "$W/code/rust-cli"
printf '[package]\nname = "rust-cli"\nversion = "0.1.0"\n\n[dependencies]\nclap = "4"\nserde = "1"\n' > Cargo.toml
mkdir -p src; echo 'fn main() {}' > src/main.rs; g add -A; commit "$(day 15)" "cli skeleton with clap"
echo '// parse' >> src/main.rs; g add -A; commit "$(day 3)" "parse config"; g push -q origin main
# 7. notes-app: for the add-project flow only. Outside code/, so the seed and
#    the Developer Intelligence scan never see it.
mkdir -p "$W/later/notes-app"; cd "$W/later/notes-app"; g init -q
printf '{ "name": "notes-app", "private": true, "dependencies": { "svelte": "^4.0.0" } }\n' > package.json
echo '# notes' > README.md; g add -A; commit "$(day 8)" "notes app skeleton"
echo "done: $W"; ls "$W/code"
