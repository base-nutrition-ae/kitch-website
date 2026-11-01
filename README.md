# KITCH — GitHub-ready code project

This is the existing KITCH website, split into source and public assets **without redesigning the app**. The original code, supplier pricing, Supabase connection and login behaviour are retained.

## First steps (GitHub + existing Netlify site)

1. Extract `KITCH_GitHub_Ready.zip` on your computer.
2. Create a **private** GitHub repository called `kitch` (leave the new repository empty).
3. Upload **the contents of the extracted folder**, including `package.json`, `netlify.toml`, `office-source.html`, `scripts/`, and `public/`, to the repository root. Do **not** upload the ZIP itself as a single file.
4. In your **existing KITCH Netlify site**, go to **Project configuration → Developer settings → Continuous deployment → Repository → Link repository**. Select your `kitch` repository. Do not create a second Netlify site.
5. Set the production branch to `main`; build command to `npm run check && npm run build`; publish directory to `public`. The `netlify.toml` already contains the command and directory.
6. Review the first deploy preview and test Sign In, ingredient prices, stock, and recipes. Publish to production only after the tests pass.

Official settings: https://docs.netlify.com/build/git-workflows/repo-permissions-linking/

## If you need to deploy without GitHub yet

Use `KITCH_Netlify_Deploy.zip`: extract it, open your existing Netlify KITCH site, go to **Deploys**, and drop the **extracted folder** into its deployment area. Do not drag it into “Add new site.” This is a separate deploy package that contains only `public/` assets.

## Local checks

Node.js is required, but no `npm install` is needed (no package dependencies):

```sh
npm run check
npm run build
npm run check
npm run dev
```

Open `http://localhost:8080` when running locally. The application uses the live KITCH Supabase project; **do not enter test stock as real restaurant inventory**.

## What is inside

- `public/index.html`: website entry point
- `public/assets/`: original CSS and JavaScript extracted from the prior single HTML file
- `public/kitch-logo.png`: favicon recovered from KITCH's existing logo
- `office-source.html`: readable Main Office source, embedded automatically during the build
- `scripts/check.mjs`: JavaScript syntax checks, asset existence checks, Main Office embed check
- `scripts/build.mjs`: resynchronizes Main Office content
- `netlify.toml`: build command and publish directory

## Launch status and known limitations

The project **passes static build and syntax checks**. These tests do not prove login, stock changes, production deductions, or permissions work in a real browser. The existing Main Office opening-stock individual Save button and some operations modules still need live functional validation. The supplied archive also lacked the separate `admin.html` console: a clearly labelled informational page is included to avoid a broken link, but it is **not** a functioning administrator console. Some modules still use browser local storage instead of permanent cloud storage. Use a staging/preview deploy to verify business flows before calling KITCH fully production-ready.

The existing public Supabase configuration is included, but **do not add service-role keys, passwords, or staff PINs** to the Git repository. The original `kitch-logo.png` was absent from the supplied archive, and has been restored from the app's embedded orange logo.
