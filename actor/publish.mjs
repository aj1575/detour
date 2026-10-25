import { readFileSync } from "node:fs";

const envFile = readFileSync(new URL("../.env", import.meta.url), "utf8");
const token = envFile.match(/^APIFY_TOKEN=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!token) throw new Error("APIFY_TOKEN is missing.");

const files = ["package.json", "Dockerfile", "src/main.js", ".actor/actor.json", ".actor/input_schema.json"].map(
  (name) => ({
    name,
    format: "TEXT",
    content: readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
  }),
);

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

const me = await fetch("https://api.apify.com/v2/users/me", { headers });
if (!me.ok) throw new Error(`Apify user lookup returned ${me.status}.`);
const username = (await me.json()).data?.username;
if (!username) throw new Error("Apify username was empty.");

const version = {
  versionNumber: "0.1",
  sourceType: "SOURCE_FILES",
  buildTag: "latest",
  sourceFiles: files,
};
const actorId = `${username}~route-buzz-finder`;
const existing = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}`, { headers });
let created = false;
if (existing.status === 404) {
  const response = await fetch("https://api.apify.com/v2/acts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "route-buzz-finder",
      title: "Route Buzz Finder",
      description: "Finds places for a route search and scores buzz from review volume.",
      versions: [version],
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Create actor ${response.status}: ${body.slice(0, 300)}`);
  created = true;
} else if (!existing.ok) {
  throw new Error(`Actor lookup returned ${existing.status}.`);
} else {
  const response = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/versions`, {
    method: "POST",
    headers,
    body: JSON.stringify(version),
  });
  const body = await response.text();
  if (!response.ok && response.status !== 409) {
    throw new Error(`Version ${response.status}: ${body.slice(0, 300)}`);
  }
}

const build = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/builds?version=0.1`, {
  method: "POST",
  headers,
  body: JSON.stringify({ version: "0.1", tag: "latest", useCache: false }),
});
const buildBody = await build.text();
if (!build.ok) throw new Error(`Build ${build.status}: ${buildBody.slice(0, 300)}`);
const buildId = JSON.parse(buildBody).data?.id;
console.log(created ? `created ${actorId}` : `updated ${actorId}`);
console.log(`build ${buildId ?? "started"}`);
