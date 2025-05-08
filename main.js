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
    stations: L.featureGroup().addTo(map),
}

// Layer control
L.control.layers({
    "Relief avalanche.report": L.tileLayer(
        "https://static.avalanche.report/tms/{z}/{x}/{y}.webp", {
        attribution: `© <a href="https://sonny.4lima.de">Sonny</a>, <a href="https://www.eea.europa.eu/en/datahub/datahubitem-view/d08852bc-7b5f-4835-a776-08362e2fbf4b">EU-DEM</a>, <a href="https://lawinen.report/">avalanche.report</a>, all licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>`
    }).addTo(map),
    "OpenStreetMap": L.tileLayer.provider("OpenStreetMap.Mapnik"),
    "OpenTopoMap": L.tileLayer.provider("OpenTopoMap"),
    "Esri WorldImagery": L.tileLayer.provider("Esri.WorldImagery"),
}, {
    "Wetterstationen": overlays.stations,
}).addTo(map);

// Maßstab
L.control.scale({
    imperial: false,
}).addTo(map);

//Wetterstationen mit Icons und Popups
async function loadStations(url) {
    console.log(url);
    let response = await fetch(url);
    let jsondata = await response.json();
    console.log(jsondata);
    L.geoJSON(jsondata, {
        attribution: "Datenquelle: <a href='https://www.data.gv.at'> Stadt Wien</a>",
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
            layer.bindPopup("Hallo");
            console.log(feature.properties);
            layer.bindPopup(`
                    <h4></i>${feature.properties.name} (${feature.geometry.coordinates[2]}) m</h4>
                    <ul>
                    <li> Lufttemperatur (C) ${feature.properties.LT!== undefined ? feature.properties.LT : "-"}</li> 
                    <!-- Kommentar: das || ist die or Funktion (siehe unten) --> 
                    <li> relative Luftfreuchte (%) ${feature.properties.RH|| "-"}</li>
                    <li> Windgeschwindigkeit (km/h) ${feature.properties.WG|| "-"}</li>
                    <li> Schneehöhe (cm) ${feature.properties.HS || "-"}</li>
                    </ul>
                    <span>${pointInTime.toLocaleString()}</span>
                 `);
        } 
    }).addTo(overlays.stations);
}
loadStations("https://static.avalanche.report/weather_stations/stations.geojson");
