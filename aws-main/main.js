/* Wetterstationen Euregio Beispiel */

// Innsbruck
let ibk = {
    lat: 47.267222,
    lng: 11.392778,
    zoom: 11,
};

// Karte initialisierenn
let map = L.map("map").setView([ibk.lat, ibk.lng], ibk.zoom);

// thematische Layer
let overlays = {
    stations: L.featureGroup(),
    temperature: L.featureGroup(),
    wind: L.featureGroup(),
    snow: L.featureGroup(),
    direction: L.featureGroup().addTo(map),
}

// Layer control
L.control.layers({
    "Relief avalanche.report": L.tileLayer(
        "https://static.avalanche.report/tms/{z}/{x}/{y}.webp", {
        attribution: `© <a href="https://sonny.4lima.de">Sonny</a>, <a href="https://www.eea.europa.eu/en/datahub/datahubitem-view/d08852bc-7b5f-4835-a776-08362e2fbf4b">EU-DEM</a>, <a href="https://lawinen.report/">avalanche.report</a>, all licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>`,
        maxZoom: 12
    }).addTo(map),
    "OpenStreetMap": L.tileLayer.provider("OpenStreetMap.Mapnik"),
    "OpenTopoMap": L.tileLayer.provider("OpenTopoMap"),
    "Esri WorldImagery": L.tileLayer.provider("Esri.WorldImagery"),
}, {
    "Wetterstationen": overlays.stations,
    "Temperatur": overlays.temperature,
    "Windgeschwindigkeit": overlays.wind,
    "Schneehöhe": overlays.snow,
    "Windrichtung": overlays.direction,
}).addTo(map);

// Maßstab
L.control.scale({
    imperial: false,
}).addTo(map);

//Rainviewer Regen
L.control.rainviewer({
    position: 'bottomleft',
    nextButtonText: '>',
    playStopButtonText: 'Play/Stop',
    prevButtonText: '<',
    positionSliderLabelText: "Hour:",
    opacitySliderLabelText: "Opacity:",
    animationInterval: 500,
    opacity: 0.5
}).addTo(map);

//Wetterstationen mit Icons und Popups
const loadedStationKeys = new Set();

async function loadStations(url, normalizeLawinenData, attribution) {
    console.log(url);
    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        console.error(`Stationsdaten konnten nicht geladen werden: ${url}`, error);
        return;
    }
    if (!response.ok) {
        console.error(`Stationsdaten konnten nicht geladen werden: ${url} (${response.status})`);
        return;
    }
    let jsondata = await response.json();
    if (normalizeLawinenData) {
        jsondata = {
            ...jsondata,
            features: jsondata.features
                .map(feature => {
                    let properties = feature.properties;
                    return {
                        ...feature,
                        properties: {
                            ...properties,
                            LT: Number.isFinite(properties.TA) ? properties.TA - 273.15 : undefined,
                            RH: Number.isFinite(properties.RH)
                                ? (properties.RH <= 1 ? properties.RH * 100 : properties.RH)
                                : undefined,
                            WG: Number.isFinite(properties.VW) ? properties.VW * 3.6 : undefined,
                            HS: Number.isFinite(properties.HS) ? properties.HS * 100 : undefined,
                            WR: Number.isFinite(properties.DW) ? properties.DW : undefined,
                        },
                    };
                }),
        };
    }
    jsondata = {
        ...jsondata,
        features: jsondata.features.filter(feature => {
            if (normalizeLawinenData) {
                let coordinates = feature.geometry.coordinates;
                let name = (feature.properties.name || "").trim().toLowerCase();
                let key = `${name}|${coordinates[0].toFixed(3)},${coordinates[1].toFixed(3)}`;
                return !loadedStationKeys.has(key);
            }
            let coordinates = feature.geometry.coordinates;
            let name = (feature.properties.name || "").trim().toLowerCase();
            let key = `${name}|${coordinates[0].toFixed(3)},${coordinates[1].toFixed(3)}`;
            loadedStationKeys.add(key);
            return true;
        }),
    };
    console.log(jsondata);
    L.geoJSON(jsondata, {
        attribution,
        pointToLayer: function (feature, latlng) {
            return L.marker(latlng, {
                icon: L.icon({
                    iconUrl: "icons/wifi.png",
                    iconAnchor: [16, 37],
                    popupAnchor: [0, -37]
                })
            });
        },
        onEachFeature: function (feature, layer) {
            let pointInTime = new Date(feature.properties.date);
            let extraMeasurements = feature.properties.source === "wetter-by" ? `
                    <li>Niederschlag (mm) ${feature.properties.precipitation ?? "-"}</li>
                    <li>Strahlung (Wh/m²) ${feature.properties.radiation ?? "-"}</li>
                    <li>Frosthinweis ${feature.properties.frost || "-"}</li>
                    <li><a href="${feature.properties.stationUrl}" target="_blank" rel="noopener">Stationsdetails</a></li>` : "";
            layer.bindPopup(`
                    <h4></i>${feature.properties.name} (${feature.geometry.coordinates[2]}) m</h4>
                    <ul>
                    <li> Lufttemperatur (C) ${feature.properties.LT !== undefined ? feature.properties.LT : "-"}</li> 
                    <li> relative Luftfreuchte (%) ${feature.properties.RH ?? "-"}</li>
                    <li> Windgeschwindigkeit (km/h) ${feature.properties.WG ?? "-"}</li>
                    <li> Schneehöhe (cm) ${feature.properties.HS ?? "-"}</li>
                    ${extraMeasurements}
                    </ul>
                    <span>${pointInTime.toLocaleString()}</span>
                 `);
        }
    }).addTo(overlays.stations);
    showTemperature(jsondata);
    showWind(jsondata);
    showSnow(jsondata);
    showDirect(jsondata);
}
async function loadAllStations() {
    await loadStations(
        "data/stations.geojson",
        false,
        "Datenquellen: <a href='https://lawinen.report/'>Lawinen.report</a>, <a href='https://static.avalanche.report/weather_stations/stations.geojson'>avalanche.report</a>, <a href='https://www.wetter-by.de'>Wetterstationen Bayern</a>"
    );
}
loadAllStations();

function showTemperature(jsondata) {
    L.geoJSON(jsondata, {
        filter: function (feature) {
            if (feature.properties.LT > -20 && feature.properties.LT < 50) {
                return true;
            }
        },
        pointToLayer: function (feature, latlng) {
            let color = getColor(feature.properties.LT, COLORS.temperature);
            return L.marker(latlng, {
                icon: L.divIcon({
                    className: "aws-div-icon",
                    html: `<span style = "background-color:${color}">${feature.properties.LT.toFixed(1)}</span>`
                }),
            })
        },
    }).addTo(overlays.temperature);
}



//Windgeschwindigkeit
function showWind(jsondata) {
    L.geoJSON(jsondata, {
        filter: function (feature) {
            if (feature.properties.WG > 0 && feature.properties.WG < 200) {
                return true;
            }
        },
        pointToLayer: function (feature, latlng) {
            let color = getColor(feature.properties.WG, COLORS.wind);
            return L.marker(latlng, {
                icon: L.divIcon({
                    className: "aws-div-icon-wind",
                    html: `<span style="background-color:${color}"> ${feature.properties.WG.toFixed(1)}</span>`
                })
            })
        },
    }).addTo(overlays.wind);
}

//Schneehöhe
function showSnow(jsondata) {
    L.geoJSON(jsondata, {
        filter: function (feature) {
            console.log(feature.properties)
            if (feature.properties.HS > 0 && feature.properties.HS < 1000) {
                return true;
            }
        },
        pointToLayer: function (feature, latlng) {
            let color = getColor(feature.properties.HS, COLORS.snow);
            return L.marker(latlng, {
                icon: L.divIcon({
                    className: "aws-div-icon-snow",
                    html: `<span style="background-color:${color}"> ${feature.properties.HS.toFixed(1)}</span>`
                })
            })
        },
    }).addTo(overlays.snow);
}

//windrichtung
function showDirect(jsondata) {

    L.geoJSON(jsondata, {
        filter: function (feature) {
            console.log(feature.properties)
            if (feature.properties.WR > 0 && feature.properties.WR < 400) {
                return true;
            }
        },
        pointToLayer: function (feature, latlng) {
            let color = getColor(feature.properties.WG, COLORS.wind);
            return L.marker(latlng, {
                icon: L.divIcon({
                    className: "aws-div-icon-wind",
                    html: `<span ><i style ="transform:rotate(${feature.properties.WR}deg);
                    color:${color}"class="fa-solid 
                    fa-circle-arrow-down"></i></span>`,
                })
            })
        },
    }).addTo(overlays.direction);
}

function getColor(value, ramp) {
    for (let rule of ramp) {
        if (value >= rule.min && value < rule.max) {
            return rule.color;
        }
    }
}


