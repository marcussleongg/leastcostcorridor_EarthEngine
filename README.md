# Least cost corridor implementation in Google Earth Engine

## Using the code
Simply copy and paste the code from *lcc.js* into Google Earth Engine JavaScript interface.
### Adding your points
Add in your points' latitude and longitude values into `var all_points_coords = [];`, having **2 points minimally**.\
If there are more than 2 points, the 2 that are furthest apart are taken as the start and end points, any other points are intermediate points. The order of the points does not matter as they will be sorted.

### Connecting only start and end points or all points
To run LCC only for two points, make sure the function call in the last line of `processAllSegments(start_point_geom, end_point_geom, intermediate_points_coords, false);` has ***false*** as the last argument.\
To run LCC between all intermediate and start and end points, make sure the function call in the last line of `processAllSegments(start_point_geom, end_point_geom, intermediate_points_coords, true);` has ***true*** as the last argument.

### Processing time
Note that GEE's **memory limit** can prevent the script from completing, depending on distance between the points. The algorithm uses downsampled cost rasters that are progressively refined, which can be adjusted to allow for script completion or quicker run times.\
Adjust `var lcc_rounds = 3;` for the number of rounds of progressive refinement. The smaller the less rounds of refinement and hence the final LCC can run on a lower resolution cost raster. This can cause **less precise** LCC outputs.\
Adjust `var initial_downsample = 50;` for the initial downsampling of the cost raster. The larger the lower the resolution and hence the quicker the processing time. This can cause **less precise** LCC outputs.
### Processing time
Note that GEE's **memory limit** can prevent the script from completing, depending on distance between the points. The algorithm uses downsampled cost rasters that are progressively refined, which can be adjusted to allow for script completion or quicker run times.\
Adjust `var lcc_rounds = 3;` for the number of rounds of progressive refinement. The smaller the less rounds of refinement and hence the final LCC can run on a lower resolution cost raster. This can cause **less precise** LCC outputs.\
Adjust `var initial_downsample = 50;` for the initial downsampling of the cost raster. The larger the lower the resolution and hence the quicker the processing time. This can cause **less precise** LCC outputs.

### Other variables that can be adjusted
Parameters like LCC tolerance threshold, which determines "how many" pixels are accepted for the LCC, region of interest cushion, color of corridor, etc. can also be changed and are found towards the top of the code.

### Use of slope-based cost functions
By default, the algorithm uses the *Anaya Hernandez method* for the creation of the cost raster. *Tobler's Hiking Cost Function* was another cost function we worked with. It can be used instead by removing the `//` for code lines in `function computeCost (slope, water_mask) {}` under the line `Tobler's Hiking Cost` and adding `//` to each line under the line `//Anaya Hernandez method`.

## References
1. Pinto, Naiara, and Timothy H. Keitt. 2008. “Beyond the Least-Cost Path: Evaluating Corridor Redundancy Using a Graph-Theoretic Approach.” Landscape Ecology 24 (2): 253–266. https://doi.org/10.1007/s10980-008-9303-y.
2. Rosenswig, Robert M., and Antonio Martínez Tuñón. 2020. “Changing Olmec Trade Routes Understood through Least Cost Path Analysis.” Journal of Archaeological Science 118: 105-146. https://doi.org/10.1016/j.jas.2020.105146.
3. Silva de la Mora, Flavio G. “The Cultural Landscapes of Maya Roads: The Material Evidence and a GIS Study from the Maya Lowlands of Chiapas and Tabasco, Mexico.” Latin American Antiquity 34, no. 4 (2023): 804–820. https://doi.org/10.1017/laq.2022.83.
4. Tang, Qiuling, and Wanfeng Dou. 2023. “An Effective Method for Computing the Least-Cost Path Using a Multi-Resolution Raster Cost Surface Model.” ISPRS International Journal of Geo-Information 12 (7): 287. https://doi.org/10.3390/ijgi12070287.
5. Lewis, Joseph. 2021. “Probabilistic Modelling for Incorporating Uncertainty in Least Cost Path Results: A Postdictive Roman Road Case Study.” Journal of Archaeological Method and Theory 28: 911-924. https://doi.org/10.1007/s10816-021-09522-w.