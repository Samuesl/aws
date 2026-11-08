const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const dataDirectory = path.join(projectRoot, "data");
const outputPath = path.join(dataDirectory, "stations.geojson");
const sources = {
    avalanche: "https://static.avalanche.report/weather_stations/stations.geojson",
    lawinen: "https://lawinen.report/eaws_weather_stations/linea.geojson",
    bavaria: "https://dlr-web-daten1.aspdienste.de/cgi-bin/rlpwetter09.pl?c=7&par=1,10,21,18&lc=1",
};

const namedEntities = {
    amp: "&",
    apos: "'",
    Auml: "Ä",
    auml: "ä",
    gt: ">",
    lt: "<",
    nbsp: " ",
    Ouml: "Ö",
    ouml: "ö",
    quot: '"',
    szlig: "ß",
    Uuml: "Ü",
    uuml: "ü",
};

function decodeHtml(value) {
    return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
        if (code[0] === "#") {
            let number = code[1].toLowerCase() === "x"
                ? Number.parseInt(code.slice(2), 16)
                : Number.parseInt(code.slice(1), 10);
            return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
        }
        return namedEntities[code] ?? entity;
    });
}

function htmlText(value) {
    return decodeHtml(value
        .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, " $1 ")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function parseNumber(value) {
    let normalized = value.replace(",", ".").trim();
    if (!normalized || ["-", "–", "—"].includes(normalized)) return undefined;
    let match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    let number = Number.parseFloat(match[0]);
    return Number.isFinite(number) ? number : undefined;
}

function parseBavariaTimestamp(html) {
    let timestampMatch = html.match(/<span\s+id=["']dt1["'][^>]*>([\s\S]*?)<\/span>\s*\(\s*<a\b[^>]*>(MEZ|MESZ)<\/a>/i);
    if (!timestampMatch) throw new Error("Could not find the current timestamp in the Bavaria station table");
    let text = htmlText(timestampMatch[1]);
    let match = text.match(/(\d{2})\.(\d{2})\.(\d{2})\s*-\s*(\d{2}):(\d{2})\s*Uhr/);
    if (!match) throw new Error(`Could not parse the current Bavaria station timestamp: ${text}`);
    let zone = timestampMatch[2];
    let [, day, month, year, hour, minute] = match;
    let offset = zone === "MESZ" ? "+02:00" : "+01:00";
    return new Date(`20${year}-${month}-${day}T${hour}:${minute}:00${offset}`).toISOString();
}

function readBavariaFeatures(html, metadata) {
    let metadataById = new Map(metadata.map(station => [station.id, station]));
    let timestamp = parseBavariaTimestamp(html);
    let featuresById = new Map();
    let rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(html)) !== null) {
        let row = rowMatch[1];
        let linkPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a\s*>/gi;
        let linkMatch;
        let stationLink;
        let stationId;

        while ((linkMatch = linkPattern.exec(row)) !== null) {
            let href = decodeHtml(linkMatch[1] || linkMatch[2]);
            let url;
            try {
                url = new URL(href, "https://www.wetter-by.de");
            } catch {
                continue;
            }
            let idMatch = url.pathname.match(/\/bamweb(?:dwd)?\/([\da-f]+)/i);
            if (!idMatch || !metadataById.has(idMatch[1])) continue;
            stationLink = { url: url.href, name: htmlText(linkMatch[3]) };
            stationId = idMatch[1];
            break;
        }
        if (!stationLink || featuresById.has(stationId)) continue;

        let cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(match => htmlText(match[1]));
        if (cells.length < 5) continue;
        let metadataEntry = metadataById.get(stationId);
        let temperature = parseNumber(cells[1]);
        let windMetersPerSecond = parseNumber(cells[4]);

        featuresById.set(stationId, {
            type: "Feature",
            id: stationId,
            geometry: { type: "Point", coordinates: metadataEntry.coordinates },
            properties: {
                name: metadataEntry.name,
                region: metadataEntry.region,
                county: metadataEntry.county,
                date: timestamp,
                LT: temperature,
                WG: windMetersPerSecond === undefined ? undefined : Number((windMetersPerSecond * 3.6).toFixed(1)),
                precipitation: parseNumber(cells[2]),
                radiation: parseNumber(cells[3]),
                frost: cells[5] && !["-", "–", "—"].includes(cells[5]) ? cells[5] : "",
                source: "wetter-by",
                stationUrl: stationLink.url,
            },
        });
    }

    return [...featuresById.values()];
}

function normalizeLawinenFeature(feature) {
    let properties = feature.properties || {};
    return {
        ...feature,
        properties: {
            ...properties,
            LT: Number.isFinite(properties.TA) ? properties.TA - 273.15 : properties.LT,
            RH: Number.isFinite(properties.RH)
                ? (properties.RH <= 1 ? properties.RH * 100 : properties.RH)
                : undefined,
            WG: Number.isFinite(properties.VW) ? properties.VW * 3.6 : properties.WG,
            HS: Number.isFinite(properties.HS) ? properties.HS * 100 : properties.HS,
            WR: Number.isFinite(properties.DW) ? properties.DW : properties.WR,
            source: properties.source || "lawinen.report",
        },
    };
}

function stationKey(feature) {
    let coordinates = feature.geometry?.coordinates;
    if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return null;
    let name = (feature.properties?.name || "").trim().toLocaleLowerCase("de-DE");
    return `${name}|${coordinates[0].toFixed(3)},${coordinates[1].toFixed(3)}`;
}

async function fetchJson(url) {
    let response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
}

async function fetchText(url) {
    let response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.text();
}

async function main() {
    let metadataSource = await fs.readFile(path.join(projectRoot, "bayern-stations-metadata.js"), "utf8");
    let context = { window: {} };
    vm.runInNewContext(metadataSource, context, { timeout: 1000 });
    let metadata = context.window.BAVARIA_STATION_METADATA;
    if (!Array.isArray(metadata) || metadata.length === 0) throw new Error("Bavaria station metadata is empty");

    let [avalancheData, lawinenData, bavariaHtml] = await Promise.all([
        fetchJson(sources.avalanche),
        fetchJson(sources.lawinen),
        fetchText(sources.bavaria),
    ]);
    let bavariaFeatures = readBavariaFeatures(bavariaHtml, metadata);
    if (bavariaFeatures.length === 0) throw new Error("No Bavaria station rows matched the local metadata");

    let combinedFeatures = [
        ...avalancheData.features,
        ...lawinenData.features.map(normalizeLawinenFeature),
        ...bavariaFeatures,
    ];
    let seen = new Set();
    combinedFeatures = combinedFeatures.filter(feature => {
        let key = stationKey(feature);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    await fs.mkdir(dataDirectory, { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify({ type: "FeatureCollection", features: combinedFeatures })}\n`, "utf8");
    console.log(`Wrote ${combinedFeatures.length} stations (${bavariaFeatures.length} Bayern additions) to ${outputPath}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
