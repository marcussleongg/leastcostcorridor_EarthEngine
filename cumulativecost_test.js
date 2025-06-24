// Creates cost raster based on Tobler's hiking cost function, capped at 10000
function computeToblersCost (slope, waterMask) {
  // Convert slope to radians
  var slopeInRad = slope.multiply(Math.PI / 180);

  // Apply Tobler's formula
  var landCost = slopeInRad.add(0.05)
    .tan()
    .abs()
    .multiply(-3.5)
    .exp()
    .multiply(6)
    .pow(-1)
    .min(10000);  // cap the Tobler cost itself before combining

  // Apply water mask
  var fullCost = landCost
    .where(waterMask.eq(10000), 10000);  // set cost=10000 where it is water

  return fullCost;
}

// Load DEM and calculate slope
var dem = ee.Image('NASA/NASADEM_HGT/001').select('elevation');
var slope = ee.Terrain.slope(dem);
Map.addLayer(slope, {min: 0, max: 89.99}, 'Slope');
//Map.addLayer(slope, {min: 0, max: 89.99}, 'Slope');

// Quick approximation of land/sea mask purely based on elevation
var landSeaMask = dem.where(dem.lte(0), 10000).where(dem.gt(0), 1);
//Map.addLayer(landSeaMask, {min: 0, max: 10000, palette: ['blue', 'green']}, 'Land/Sea Mask');

// Create cost raster
var tobCost = computeToblersCost(slope, landSeaMask);
print(tobCost);
//Map.addLayer(tobCost, {min: 0, max: 10000, palette: ['white', 'green', 'yellow', 'red']}, 'Cost Surface');

// Declare the points to be used for testing


// Converting the point to image
var myPoint = ee.FeatureCollection('projects/ee-poleinikov/assets/scotstart');
Map.addLayer(myPoint, {color: 'blue'}, 'Uploaded Point');

var pointImage = myPoint
  .map(function(f) { return f.set('constant', 1); })  // assign constant value
  .reduceToImage({
    properties: ['constant'],
    reducer: ee.Reducer.first()
  });

// Run cumulative cost function
var cCost = tobCost.cumulativeCost(pointImage, 3500, false)
Map.addLayer(cCost, {min: 0, max: 3500, palette: ['white', 'yellow', 'orange', 'red', 'black']}, 'Cumulative Cost')