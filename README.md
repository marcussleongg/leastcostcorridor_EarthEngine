# Least cost corridor implementation in Google Earth Engine
To run the algorithm, simply copy and paste into Google Earth Engine.
Add in your points' latitude and longitude values, minimally having 2 points. The 2 points that are furthest apart are taken as the start and end points, any other points are intermediate points.

To run LCC only for two points, make sure processAllSegments function call in the last line of code has 'false' as its fourth parameter.
To run LCC between all intermediate and start and end points, make sure processAllSegments function call in the last line of code has 'true' as its fourth parameter.

Note that GEE's memory limit can prevent the script from completing, depending on distance between the points. The algorithm uses progressive refinement rounds of the cost raster, and along with the initial downsampling, can be adjusted to allow for script completion or quicker run times.

Other parameters like LCC tolerance threshold, which determines "how many" pixels are accepted for the LCC, region of interest cushion, color of corridor, etc. can also be changed towards the top of the code.