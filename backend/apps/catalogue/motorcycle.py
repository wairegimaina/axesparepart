"""Axe sells motorcycle spare parts only. Reference data used by `seed` and the 0003 data migration."""

CATEGORY_TREE = {
    "Engine parts": ["Pistons & rings", "Cylinder kits", "Gaskets & seals", "Valves & timing",
                     "Carburettors & fuel", "Spark plugs & ignition", "Exhaust & silencers"],
    "Drive & transmission": ["Sprockets", "Chains", "Chain & sprocket kits", "Clutch parts", "Gears & gearbox"],
    "Brakes": ["Brake shoes", "Brake pads", "Brake discs", "Brake cables & levers"],
    "Electrical & lighting": ["Batteries", "Headlights & bulbs", "Indicators & tail lights", "CDI & ignition coils",
                              "Wiring & switches", "Starter motors"],
    "Suspension & steering": ["Front forks", "Shock absorbers", "Handlebars & grips", "Steering bearings"],
    "Wheels & tyres": ["Tyres", "Tubes", "Rims & spokes", "Wheel bearings"],
    "Body & frame": ["Mudguards", "Side covers & panels", "Seats", "Mirrors", "Footrests & stands", "Carriers"],
    "Service parts": ["Oil filters", "Air filters", "Engine oil", "Clutch & throttle cables"],
    "Accessories": ["Helmets & riding gear", "Locks & security", "Covers & bags"],
}

BUSINESS_CATEGORIES = ["Spare parts dealer", "Tyres & wheels", "Oils & lubricants", "Electrical & batteries",
                       "Accessories & riding gear", "Workshop & repairs"]

BRANDS = ["Bajaj", "TVS", "Honda", "Yamaha", "Suzuki", "Haojin", "Boxer", "Captain", "Skygo", "Lifan", "NGK",
          "Bosch", "Denso", "SKF", "Daido", "Exide", "Chloride Exide", "Duro", "Kenda", "Motul", "Total"]

# Where products in the old (general-industry) categories go. Anything not listed is archived.
OLD_TO_NEW = {
    "Engine parts": ("Engine parts", None),
    "Cooling system": ("Engine parts", None),
    "Filters": ("Service parts", None),
    "Brakes": ("Brakes", None),
    "Suspension & steering": ("Suspension & steering", None),
    "Electrical & lighting": ("Electrical & lighting", None),
    "Transmission": ("Drive & transmission", None),
    "Belts & chains": ("Drive & transmission", "Chains"),
    "Body parts": ("Body & frame", None),
    "Bearings": ("Wheels & tyres", "Wheel bearings"),
    "Cables & wiring": ("Electrical & lighting", "Wiring & switches"),
    "Batteries & power": ("Electrical & lighting", "Batteries"),
    "Sensors": ("Electrical & lighting", None),
}
OLD_TOP_LEVEL = ["Automotive", "Industrial", "Medical equipment", "Electrical", "Agricultural"]
OLD_BUSINESS_CATEGORIES = ["Automotive", "Industrial", "Medical equipment", "Electrical", "Agricultural", "Construction"]
OLD_BRANDS_TO_DROP = ["Toyota Genuine", "Grundfos", "Siemens", "Schneider Electric", "Philips", "GE Healthcare",
                      "Mindray", "Gates", "Parker", "ABB", "Cummins"]
