"""Canonical ingredient dictionary: maps the many spellings of an ingredient (English, French and
Modern Standard Arabic; plus the older Arabic-latin spellings ported from the old frontend
ingredient-merge.ts) to one canonical English name, an aisle, and a pantry-staple flag.
The French and Arabic names live in `ingredient_names.py` (data only); the original English
dictionary below is frozen so purchase marks stored under the old keys keep matching.

Used by the content importer and recipe create/update (to stamp each ingredient's aisle),
by the grocery list (to merge "oignons" with "onion"), and for manual grocery extras.
Unknown ingredients still work: they keep their normalized name and get an aisle from
keyword rules (or "other").

Add an alias here whenever the grocery list shows the same thing on two lines.
"""

import re
import unicodedata
from functools import lru_cache

from .ingredient_names import EXTRA_EN, NAMES, NEW_ENTRIES

AISLES = [
    "produce",
    "meat-fish",
    "dairy-eggs",
    "bakery",
    "pantry",
    "spices",
    "frozen",
    "drinks",
    "household",
    "other",
]

# canonical name: (aisle, is pantry staple, aliases)
_DICTIONARY_V1: dict[str, tuple[str, bool, list[str]]] = {
    # --- produce ---
    "onion": ("produce", False, ["onions", "yellow onion", "brown onion", "white onion", "oignon", "oignons", "basal"]),
    "red onion": ("produce", False, ["red onions", "oignon rouge", "purple onion"]),
    "spring onion": ("produce", False, ["spring onions", "green onion", "green onions", "scallion", "scallions", "oignon vert", "cebette"]),
    "shallot": ("produce", False, ["shallots", "echalote", "echalotes"]),
    "leek": ("produce", False, ["leeks", "poireau", "poireaux"]),
    "garlic": ("produce", False, ["garlic clove", "garlic cloves", "cloves garlic", "clove garlic", "ail", "gousse d ail", "gousses d ail", "toum", "thoum"]),
    "ginger": ("produce", False, ["fresh ginger", "ginger root", "gingembre", "gingembre frais"]),
    "potato": ("produce", False, ["potatoes", "pomme de terre", "pommes de terre", "batata", "patate", "patates"]),
    "sweet potato": ("produce", False, ["sweet potatoes", "patate douce", "patates douces", "kumara"]),
    "tomato": ("produce", False, ["tomatoes", "tomate", "tomates", "ripe tomatoes", "plum tomatoes", "roma tomatoes", "tomatich"]),
    "cherry tomato": ("produce", False, ["cherry tomatoes", "tomates cerises"]),
    "carrot": ("produce", False, ["carrots", "carotte", "carottes", "zrodiya"]),
    "celery": ("produce", False, ["celery stalk", "celery stalks", "celery stick", "celery sticks", "celeri", "branche de celeri"]),
    "cucumber": ("produce", False, ["cucumbers", "concombre", "concombres"]),
    "zucchini": ("produce", False, ["zucchinis", "courgette", "courgettes", "kousa"]),
    "eggplant": ("produce", False, ["eggplants", "aubergine", "aubergines", "brinjal", "badenjal", "bedenjal"]),
    "bell pepper": ("produce", False, ["bell peppers", "peppers", "sweet pepper", "capsicum", "poivron", "poivrons"]),
    "red bell pepper": ("produce", False, ["red bell peppers", "red pepper", "red peppers", "poivron rouge", "poivrons rouges"]),
    "green bell pepper": ("produce", False, ["green bell peppers", "green pepper", "green peppers", "poivron vert", "poivrons verts", "felfel"]),
    "chili pepper": ("produce", False, ["red chilies", "red chile pepper", "red chile peppers", "chile pepper", "chile peppers", "scotch bonnet", "scotch bonnet pepper", "scotch bonnet chile peppers", "habanero", "chili", "chilli", "chilies", "chillies", "chili peppers", "fresh chili", "green chili", "green chilies", "red chili", "bird's eye chili", "bird's eye chilies", "thai bird chilies", "thai chilies", "thai bird chili", "piment", "piment vert", "jalapeno", "jalapenos", "serrano", "green chilli", "green chillies", "red chilli", "red chillies", "dried red chillies", "dried red chilies"]),
    "lemon": ("produce", False, ["lemon zest", "zest of a lemon", "lemons", "citron", "citrons", "lemon juice", "jus de citron", "juice of a lemon"]),
    "lime": ("produce", False, ["lime zest", "limes", "citron vert", "lime juice"]),
    "dried lime": ("spices", False, ["dried limes", "black lime", "black limes", "loomi", "noomi basra", "limoo omani"]),
    "fennel bulb": ("produce", False, ["fennel bulbs", "fresh fennel", "bulb fennel", "finocchio", "fenouil frais"]),
    "artichoke hearts": ("pantry", False, ["artichoke heart", "artichokes", "artichaut", "artichauts", "coeurs d artichaut", "qarnoun"]),
    "orange": ("produce", False, ["oranges", "orange juice"]),
    "apple": ("produce", False, ["apples", "pomme", "pommes"]),
    "banana": ("produce", False, ["bananas", "banane", "bananes", "plantain", "plantains"]),
    "mango": ("produce", False, ["mangoes", "mangos", "mangue"]),
    "avocado": ("produce", False, ["avocados", "avocat", "avocats"]),
    "parsley": ("produce", False, ["fresh parsley", "flat-leaf parsley", "flat leaf parsley", "italian parsley", "persil", "maadnous", "maadnouss"]),
    "cilantro": ("produce", False, ["cilantro leaves", "coriander leaves and stems", "coriander leaves", "fresh coriander", "coriander leaf", "coriandre fraiche", "coriandre", "kosbor", "kesbour"]),
    "mint": ("produce", False, ["fresh mint", "mint leaves", "menthe", "naana", "nana"]),
    "basil": ("produce", False, ["fresh basil", "basil leaves", "basilic"]),
    "dill": ("produce", False, ["fresh dill", "aneth"]),
    "thyme": ("produce", False, ["fresh thyme", "thym", "thyme sprigs"]),
    "rosemary": ("produce", False, ["fresh rosemary", "romarin"]),
    "spinach": ("produce", False, ["baby spinach", "epinards", "epinard"]),
    "cabbage": ("produce", False, ["white cabbage", "green cabbage", "chou", "napa cabbage", "chinese cabbage"]),
    "lettuce": ("produce", False, ["leafy lettuce", "lettuce leaves", "laitue", "romaine", "salad leaves"]),
    "mushroom": ("produce", False, ["mushrooms", "button mushrooms", "champignon", "champignons"]),
    "cauliflower": ("produce", False, ["chou-fleur", "chou fleur"]),
    "broccoli": ("produce", False, ["brocoli"]),
    "green beans": ("produce", False, ["green bean", "haricots verts", "string beans"]),
    "peas": ("produce", False, ["green peas", "petits pois", "pea"]),
    "corn": ("produce", False, ["sweetcorn", "corn kernels", "mais"]),
    "pumpkin": ("produce", False, ["squash", "butternut squash", "potiron", "citrouille", "courge"]),
    "turnip": ("produce", False, ["turnips", "navet", "navets"]),
    "beetroot": ("produce", False, ["beet", "beets", "betterave"]),
    "okra": ("produce", False, ["okra pods", "gombo", "bamia", "bamya"]),
    "bean sprouts": ("produce", False, ["bean sprout", "mung bean sprouts", "soja frais"]),
    "lemongrass": ("produce", False, ["lemon grass", "citronnelle"]),
    "kale": ("produce", False, ["curly kale", "lacinato kale"]),
    "collard greens": ("produce", False, ["collards", "collard"]),
    "herbs": ("produce", False, ["mixed herbs", "fresh herbs"]),
    "dates": ("produce", False, ["date", "dattes", "deglet nour", "tmar"]),
    # --- meat & fish ---
    "ground beef": ("meat-fish", False, ["minced beef", "beef mince", "ground meat", "minced meat", "viande hachee", "viande de boeuf hachee", "kefta", "kofta", "lham mefroum", "lahm mafroum"]),
    "beef": ("meat-fish", False, ["stewing beef", "beef chuck", "chuck", "round steak", "steak", "boeuf", "viande de boeuf", "beef stew meat"]),
    "lamb": ("meat-fish", False, ["lamb shoulder", "lamb leg", "leg of lamb", "mutton", "agneau", "lham", "lamb chops"]),
    "ground lamb": ("meat-fish", False, ["minced lamb", "lamb mince", "agneau hache"]),
    "chicken": ("meat-fish", False, ["whole chicken", "poulet", "djaj", "chicken pieces"]),
    "chicken thighs": ("meat-fish", False, ["chicken thigh", "cuisses de poulet", "poulet cuisse", "boneless chicken thighs"]),
    "chicken breast": ("meat-fish", False, ["chicken fillet", "chicken fillets", "chicken breasts", "blanc de poulet", "poulet blanc", "filet de poulet"]),
    "chicken drumsticks": ("meat-fish", False, ["chicken legs", "pilons de poulet"]),
    "pork": ("meat-fish", False, ["pork shoulder", "pork belly", "porc", "pork loin"]),
    "ground pork": ("meat-fish", False, ["minced pork", "pork mince"]),
    "bacon": ("meat-fish", False, ["salt pork", "lardons", "pancetta", "streaky bacon"]),
    "sausage": ("meat-fish", False, ["sausages", "saucisse", "saucisses", "merguez", "chorizo"]),
    "ham": ("meat-fish", False, ["jambon"]),
    "fish": ("meat-fish", False, ["white fish", "fish fillets", "poisson", "hout"]),
    "salmon": ("meat-fish", False, ["salmon fillet", "salmon fillets", "saumon"]),
    "cod": ("meat-fish", False, ["cod fillets", "cabillaud", "morue", "salt cod"]),
    "tuna": ("meat-fish", False, ["canned tuna", "thon"]),
    "sardines": ("meat-fish", False, ["sardine", "sardinha"]),
    "shrimp": ("meat-fish", False, ["prawns", "prawn", "crevettes", "crevette"]),
    "mussels": ("meat-fish", False, ["moules"]),
    "crayfish": ("meat-fish", False, ["ground crayfish", "dried crayfish"]),
    "anchovies": ("meat-fish", False, ["anchovy", "anchois", "anchovy fillets"]),
    # --- dairy & eggs ---
    "egg": ("dairy-eggs", False, ["eggs", "large eggs", "large egg", "oeuf", "oeufs", "beid", "egg yolk", "egg yolks", "egg white", "egg whites"]),
    "milk": ("dairy-eggs", False, ["whole milk", "lait", "hlib", "halib"]),
    "butter": ("dairy-eggs", False, ["unsalted butter", "salted butter", "beurre", "zebda"]),
    "cream": ("dairy-eggs", False, ["heavy cream", "double cream", "whipping cream", "single cream", "creme", "creme liquide"]),
    "yogurt": ("dairy-eggs", False, ["yoghurt", "plain yogurt", "greek yogurt", "natural yogurt", "yaourt", "laban", "leben", "curd", "dahi"]),
    "cheese": ("dairy-eggs", False, ["fromage", "grated cheese"]),
    "parmesan": ("dairy-eggs", False, ["parmesan cheese", "parmigiano", "parmigiano-reggiano", "grated parmesan"]),
    "mozzarella": ("dairy-eggs", False, ["mozzarella cheese"]),
    "feta": ("dairy-eggs", False, ["feta cheese"]),
    "cheddar": ("dairy-eggs", False, ["cheddar cheese"]),
    "ricotta": ("dairy-eggs", False, ["ricotta cheese"]),
    "paneer": ("dairy-eggs", False, []),
    "ghee": ("dairy-eggs", False, ["clarified butter", "smen", "samna"]),
    "tempeh": ("dairy-eggs", False, []),
    "tofu": ("dairy-eggs", False, ["firm tofu", "silken tofu", "bean curd"]),
    # --- bakery ---
    "bread": ("bakery", False, ["loaf", "white bread", "pain", "khobz", "crusty bread"]),
    "kesra": ("bakery", False, ["kesra bread", "kisra", "khobz kesra", "matloue", "matlou", "khobz el tajine", "taguella"]),
    "pita": ("bakery", False, ["pita bread", "pitta", "flatbread", "flatbreads", "khobz arabi"]),
    "tortillas": ("bakery", False, ["tortilla", "corn tortillas", "flour tortillas"]),
    "injera": ("bakery", False, []),
    "breadcrumbs": ("bakery", False, ["bread crumbs", "chapelure", "panko"]),
    # --- pantry ---
    "olive oil": ("pantry", True, ["extra virgin olive oil", "extra-virgin olive oil", "huile d olive", "zit zitoun", "zitoun"]),
    "vegetable oil": ("pantry", True, ["neutral cooking oil", "neutral oil", "oil", "cooking oil", "sunflower oil", "neutral oil", "canola oil", "huile", "huile vegetale", "huile de tournesol"]),
    "sesame oil": ("pantry", False, ["toasted sesame oil"]),
    "salt": ("spices", True, ["salt and pepper", "coarse salt", "sea salt", "kosher salt", "table salt", "sel", "melh"]),
    "white pepper": ("spices", True, ["ground white pepper", "poivre blanc", "felfel abiad"]),
    "black pepper": ("spices", True, ["pepper", "black peppercorns", "peppercorns", "whole black peppercorns", "ground black pepper", "freshly ground black pepper", "poivre", "poivre noir", "felfel kehal"]),
    "water": ("other", True, ["eau", "warm water", "cold water", "boiling water", "lma"]),
    "sugar": ("pantry", True, ["white sugar", "granulated sugar", "caster sugar", "sucre", "sucre en poudre", "sokkar"]),
    "brown sugar": ("pantry", False, ["cassonade", "sucre roux", "light brown sugar", "dark brown sugar", "palm sugar", "jaggery"]),
    "icing sugar": ("pantry", False, ["powdered sugar", "confectioners sugar", "sucre glace"]),
    "honey": ("pantry", False, ["miel", "aassel"]),
    "flour": ("pantry", True, ["all-purpose flour", "plain flour", "all purpose flour", "wheat flour", "farine", "dqiq"]),
    "semolina": ("pantry", False, ["fine semolina", "coarse semolina", "semoule", "smid"]),
    "couscous": ("pantry", False, ["kesksou", "seksu", "couscous grain", "fine couscous", "mesfouf"]),
    "rice": ("pantry", False, ["steamed rice", "cooked rice", "long grain rice", "long-grain rice", "white rice", "basmati rice", "jasmine rice", "riz", "rouz"]),
    "arborio rice": ("pantry", False, ["risotto rice", "carnaroli rice"]),
    "pasta": ("pantry", False, ["spaghetti", "macaroni", "orzo", "vermicelli", "lasagne sheets", "lasagna sheets", "tlitli", "trida", "penne", "linguine", "fettuccine", "tagliatelle", "pates", "noodles"]),
    "rice noodles": ("pantry", False, ["rice vermicelli", "rice sticks", "pho noodles"]),
    "lentils": ("pantry", False, ["lentil", "red lentils", "green lentils", "brown lentils", "lentilles", "aadas", "masoor dal", "dal"]),
    "chickpeas": ("pantry", False, ["chickpea", "garbanzo beans", "pois chiches", "hommos", "hummus beans"]),
    "beans": ("pantry", False, ["white beans", "kidney beans", "black beans", "cannellini beans", "haricots blancs", "loubia", "pinto beans"]),
    "tomato paste": ("pantry", False, ["tomato puree", "concentre de tomate", "double concentre de tomate", "tomato concentrate"]),
    "canned tomatoes": ("pantry", False, ["chopped tomatoes", "crushed tomatoes", "tinned tomatoes", "tomates concassees", "passata"]),
    "stock": ("pantry", False, ["broth", "bouillon", "stock cube"]),
    "chicken stock": ("pantry", False, ["chicken stock powder", "chicken bouillon powder", "chicken bouillon", "chicken broth", "bouillon de poulet", "chicken stock cube"]),
    "beef stock": ("pantry", False, ["beef broth", "bouillon de boeuf"]),
    "vegetable stock": ("pantry", False, ["vegetable bouillon powder", "vegetable bouillon", "vegetable broth", "bouillon de legumes", "veggie stock"]),
    "tamarind": ("pantry", False, ["tamarind paste", "tamarind juice", "tamarind pulp", "tamarin"]),
    "pandan": ("pantry", False, ["pandan essence", "pandan extract", "pandan leaves"]),
    "galangal": ("produce", False, ["galangal root", "khaa"]),
    "vinegar": ("pantry", False, ["white vinegar", "wine vinegar", "red wine vinegar", "cider vinegar", "rice vinegar", "vinaigre"]),
    "soy sauce": ("pantry", False, ["light soy sauce", "dark soy sauce", "sauce soja", "shoyu", "tamari"]),
    "fish sauce": ("pantry", False, ["nuoc mam", "nam pla", "patis"]),
    "coconut milk": ("pantry", False, ["lait de coco", "coconut cream"]),
    "tahini": ("pantry", False, ["sesame paste", "tahina"]),
    "baking powder": ("pantry", False, ["levure chimique"]),
    "baking soda": ("pantry", False, ["bicarbonate of soda", "bicarbonate de soude"]),
    "yeast": ("pantry", False, ["dry yeast", "active dry yeast", "instant yeast", "levure", "levure boulangere"]),
    "cornstarch": ("pantry", False, ["cornflour", "corn starch", "maizena"]),
    "oats": ("pantry", False, ["rolled oats", "oatmeal", "flocons d avoine"]),
    "chocolate": ("pantry", False, ["dark chocolate", "chocolat", "chocolat noir"]),
    "cocoa powder": ("pantry", False, ["cocoa", "cacao"]),
    "vanilla": ("pantry", False, ["vanilla extract", "vanilla sugar", "sucre vanille", "vanille"]),
    "prunes": ("pantry", False, ["prune", "pitted prunes", "dried plums", "pruneaux", "barqouq"]),
    "dried apricots": ("pantry", False, ["apricots", "dried apricot", "abricots secs", "mechmech"]),
    "bulgur": ("pantry", False, ["fine bulgur", "coarse bulgur", "bulghur", "burghul"]),
    "molokhia": ("pantry", False, ["frozen molokhia", "dried molokhia powder", "molokhia powder", "mloukhia", "mulukhiyah", "jute leaves"]),
    "malsouka sheets": ("pantry", False, ["malsouka", "brik sheets", "brik pastry", "warqa"]),
    "raisins": ("pantry", False, ["raisin", "sultanas", "raisins secs", "zbib"]),
    "olives": ("pantry", False, ["olive", "black olives", "green olives", "olives vertes", "olives noires"]),
    "almonds": ("pantry", False, ["almond", "blanched almonds", "slivered almonds", "ground almonds", "amandes", "louz", "almond flour"]),
    "walnuts": ("pantry", False, ["walnut", "noix"]),
    "peanuts": ("pantry", False, ["peanut", "cacahuetes", "groundnuts"]),
    "peanut butter": ("pantry", False, ["unsweetened peanut butter", "natural peanut butter", "beurre de cacahuete"]),
    "pine nuts": ("pantry", False, ["pignons", "pignons de pin"]),
    "pistachios": ("pantry", False, ["pistachio", "pistaches"]),
    "sesame seeds": ("spices", False, ["sesame", "graines de sesame", "jeljlan"]),
    "orange blossom water": ("pantry", False, ["orange flower water", "eau de fleur d oranger", "ma zhar"]),
    "rose water": ("pantry", False, ["rosewater", "eau de rose"]),
    "shrimp paste": ("pantry", False, ["terasi", "belacan", "kapi"]),
    "fried shallots": ("pantry", False, ["crispy shallots", "crispy fried shallots"]),
    "crackers": ("pantry", False, ["kerupuk", "prawn crackers", "shrimp crackers"]),
    "evaporated milk": ("pantry", False, ["lait concentre non sucre"]),
    "condensed milk": ("pantry", False, ["sweetened condensed milk", "lait concentre sucre"]),
    "glutinous rice": ("pantry", False, ["sticky rice", "sweet rice"]),
    "harissa": ("pantry", False, ["harissa paste"]),
    "mustard": ("pantry", False, ["dijon mustard", "moutarde"]),
    "mayonnaise": ("pantry", False, ["mayo"]),
    "capers": ("pantry", False, ["caper", "capres"]),
    "preserved lemon": ("pantry", False, ["preserved lemons", "citron confit", "citrons confits"]),
    # --- spices ---
    "cumin": ("spices", False, ["ground cumin", "cumin seeds", "kamoun", "jeera"]),
    "paprika": ("spices", False, ["sweet paprika", "smoked paprika", "felfel ahmar", "piment doux"]),
    "chili powder": ("spices", False, ["chilli powder", "red chili flakes", "dried chili flakes", "chile flakes", "cayenne", "cayenne pepper", "chili flakes", "red pepper flakes", "piment de cayenne", "chilli flakes", "aleppo pepper", "red chile flakes", "red chilli flakes"]),
    "turmeric": ("spices", False, ["ground turmeric", "curcuma", "kurkum", "haldi"]),
    "cinnamon": ("spices", False, ["ground cinnamon", "cinnamon stick", "cannelle", "kerfa"]),
    "coriander seeds": ("spices", False, ["ground coriander", "coriander", "coriandre moulue", "graines de coriandre"]),
    "ginger powder": ("spices", False, ["ground ginger", "gingembre moulu", "skinjbir"]),
    "ras el hanout": ("spices", False, ["ras al hanout"]),
    "garam masala": ("spices", False, []),
    "curry powder": ("spices", False, ["curry", "poudre de curry"]),
    "bay leaf": ("spices", False, ["bay leaves", "laurier", "feuille de laurier"]),
    "oregano": ("spices", False, ["dried oregano", "origan"]),
    "dried thyme": ("spices", False, ["thym seche"]),
    "dried mint": ("spices", False, ["menthe sechee"]),
    "nutmeg": ("spices", False, ["ground nutmeg", "muscade", "noix de muscade"]),
    "cloves": ("spices", False, ["ground cloves", "clous de girofle", "whole cloves"]),
    "cardamom": ("spices", False, ["cardamom pods", "cardamome", "elaichi"]),
    "saffron": ("spices", False, ["safran", "zaafran", "saffron threads"]),
    "star anise": ("spices", False, ["anis etoile", "badiane"]),
    "allspice": ("spices", False, ["piment de la jamaique"]),
    "sumac": ("spices", False, []),
    "za'atar": ("spices", False, ["zaatar", "zahtar"]),
    "mustard seeds": ("spices", False, ["black mustard seeds", "graines de moutarde"]),
    "fennel seeds": ("spices", False, ["graines de fenouil", "ground fennel", "fennel"]),
    "caraway": ("spices", False, ["caraway seeds", "carvi", "karwiya"]),
    "berbere": ("spices", False, ["berbere spice blend", "berbere spice", ]),
    # --- frozen ---
    "frozen peas": ("frozen", False, ["petits pois surgeles"]),
    "puff pastry": ("frozen", False, ["pate feuilletee"]),
    "ice cream": ("frozen", False, ["glace"]),
    # --- drinks ---
    "white wine": ("drinks", False, ["dry white wine", "vin blanc"]),
    "red wine": ("drinks", False, ["vin rouge"]),
    "beer": ("drinks", False, ["biere"]),
    "coffee": ("drinks", False, ["espresso", "cafe"]),
    "tea": ("drinks", False, ["green tea", "black tea", "the vert"]),
    # --- household ---
    "paper towels": ("household", False, ["kitchen roll", "paper towel"]),
    "dish soap": ("household", False, ["washing up liquid", "dishwashing liquid"]),
    "aluminum foil": ("household", False, ["foil", "tin foil", "aluminium foil"]),
    "baking paper": ("household", False, ["parchment paper", "papier sulfurise"]),
    "trash bags": ("household", False, ["bin bags", "garbage bags"]),
}

# The original dictionary plus the entries added later (see ingredient_names.py).
_DICTIONARY: dict[str, tuple[str, bool, list[str]]] = {**_DICTIONARY_V1, **NEW_ENTRIES}

DEFAULT_STAPLES = sorted(name for name, (_aisle, staple, _aliases) in _DICTIONARY.items() if staple)

# Words that describe size/prep, not what you buy. Stripped before a second lookup.
_DESCRIPTORS = {
    "large", "small", "medium", "big", "fresh", "freshly", "chopped", "finely", "roughly",
    "minced", "diced", "sliced", "grated", "crushed", "ground", "peeled", "ripe", "whole",
    "boneless", "skinless", "dried", "raw", "cooked", "thinly", "thick", "thin", "about",
    "of", "a", "an", "the", "some", "few", "handful", "organic", "good", "quality",
    "unsalted", "salted", "plain", "dry", "flat", "toasted", "roasted", "frozen", "canned",
    "tinned", "skin-on", "bone-in", "unsweetened", "leafy", "steamed", "neutral", "lean", "hot", "warm", "cold", "softened", "melted",
}

# French and Arabic size/prep words (already in matching form: no accents, ة -> ه, no ال).
# "haché" / "moulu" are deliberately absent: "boeuf haché" and "gingembre moulu" are different
# products from "boeuf" and "gingembre"; those are listed as explicit names instead.
_FR_DESCRIPTORS = {
    "frais", "fraiche", "fraiches", "gros", "grosse", "grosses", "grand", "grande", "grands",
    "grandes", "petit", "petite", "petits", "petites", "moyen", "moyenne", "moyens", "moyennes",
    "pele", "pelee", "peles", "pelees", "emince", "emincee", "eminces", "emincees", "coupe",
    "coupee", "coupes", "coupees", "cuit", "cuite", "cuits", "cuites", "cru", "crue", "crus",
    "crues", "entier", "entiere", "entiers", "entieres", "bio", "rape", "rapee", "rapes",
    "rapees", "environ", "quelques", "ramolli", "ramollie", "nature",
}
_AR_DESCRIPTORS = {
    "طازج", "طازجه", "طازجين", "كبير", "كبيره", "كبار", "صغير", "صغيره", "صغار", "متوسط",
    "متوسطه", "مقشر", "مقشره", "مقطع", "مقطعه", "مفروم", "مفرومه", "مبشور", "مبشوره",
    "مطحون", "مطحونه", "ناعم", "ناعمه", "مسلوق", "مسلوقه", "مجفف", "مجففه", "من",
}
_ALL_DESCRIPTORS = _DESCRIPTORS | _FR_DESCRIPTORS | _AR_DESCRIPTORS

# French articles / partitives. Leading ones are dropped from unknown names, and the
# particle-free index lets "farine de blé", "farine blé" and "la farine de blé" meet.
_FR_PARTICLES = {"de", "du", "des", "d", "la", "le", "les", "l", "au", "aux", "un", "une"}

# Fallback aisle by keyword, checked in order, for names the dictionary doesn't know.
_KEYWORD_AISLES: list[tuple[tuple[str, ...], str]] = [
    (("chicken", "beef", "lamb", "pork", "veal", "turkey", "duck", "fish", "salmon", "tuna",
      "shrimp", "prawn", "crab", "squid", "octopus", "mince", "sausage", "steak", "meat",
      "poulet", "boeuf", "agneau", "viande", "poisson"), "meat-fish"),
    (("cheese", "milk", "cream", "yogurt", "yoghurt", "butter", "egg", "fromage", "lait"), "dairy-eggs"),
    (("bread", "bun", "roll", "baguette", "pastry", "brioche", "croissant", "naan", "pita"), "bakery"),
    (("frozen", "surgele"), "frozen"),
    (("powder", "seed", "seeds", "spice", "masala", "pepper flakes", "dried herb", "epice"), "spices"),
    (("wine", "juice", "beer", "soda", "coffee", "tea"), "drinks"),
    (("oil", "vinegar", "sauce", "paste", "flour", "sugar", "rice", "pasta", "noodle", "bean",
      "lentil", "stock", "broth", "nut", "syrup", "can", "tinned", "canned", "jam"), "pantry"),
    (("leaf", "leaves", "herb", "lettuce", "berry", "berries", "fruit", "vegetable", "root",
      "pepper", "squash", "melon", "grape", "cherry", "pear", "peach", "plum", "kale", "chard"), "produce"),
    (("towel", "soap", "detergent", "foil", "wrap", "bag", "napkin", "sponge", "tissue"), "household"),
]

# French and Arabic keyword fallbacks (appended, so they never outrank the English rules above).
# Arabic entries are written naturally and folded when the module loads.
_KEYWORD_AISLES_MULTI: list[tuple[tuple[str, ...], str]] = [
    (("لحم", "لحوم", "سمك", "دجاج", "جمبري", "روبيان", "jambon", "saucisse", "crevette"), "meat-fish"),
    (("جبن", "جبنة", "حليب", "لبن", "زبدة", "بيض", "كريمة", "قشدة", "yaourt", "creme", "beurre", "oeuf"), "dairy-eggs"),
    (("خبز", "فطيرة", "كعك", "pain", "croissant"), "bakery"),
    (("مجمد", "مجمدة", "congele", "surgele"), "frozen"),
    (("بهار", "بهارات", "توابل", "مطحون", "epices", "epice"), "spices"),
    (("عصير", "نبيذ", "شاي", "قهوة", "مشروب", "jus", "biere", "cafe"), "drinks"),
    (("زيت", "سكر", "دقيق", "طحين", "ارز", "معكرونة", "صلصة", "معجون", "مرق", "عدس", "حمص",
      "فاصوليا", "مكسرات", "معلب", "huile", "sucre", "farine", "riz", "pates", "sauce", "conserve"), "pantry"),
    (("خضار", "خضروات", "فاكهة", "اوراق", "عشب", "legume", "fruit", "salade", "herbe"), "produce"),
    (("منديل", "مناديل", "صابون", "كيس", "اكياس", "essuie", "savon"), "household"),
]


# ---------- normalization ----------

_ARABIC_LETTERS = "ء-ي"
_CHAR_MAP = str.maketrans({
    # Arabic-Indic and Persian digits -> ASCII
    **{chr(0x0660 + i): str(i) for i in range(10)},
    **{chr(0x06F0 + i): str(i) for i in range(10)},
    "٫": ".", "،": ",", "؛": ";",
    # letter variants: alef seats, alef maqsura, taa marbuta, Persian kaf/yeh
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ک": "ك", "ی": "ي",
})


def _normalize_legacy(text: str) -> str:
    """The pre-multilingual normalization, kept verbatim: Arabic letters vanish, so keys of
    names that resolved under it are reproduced exactly (used for old purchase-mark keys)."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"\(.*?\)", " ", text)
    text = text.split(",")[0]
    text = text.replace("’", "'").replace("d'", "d ").replace("l'", "l ")
    text = re.sub(r"[^a-z0-9' -]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _strip_article(word: str) -> str:
    """Arabic definite article: ال (and the assimilated forms are written with it too)."""
    if len(word) >= 4 and word.startswith("ال"):
        return word[2:]
    return word


def normalize_text(text: str) -> str:
    """The matching form of an ingredient name, for English, French and Arabic: NFKC, lowercase,
    French ligatures (œ, æ), accents folded, Arabic digits -> ASCII, Arabic tashkeel and tatweel
    dropped, أ/إ/آ -> ا, ى -> ي, ة -> ه, the Arabic article ال removed from each word,
    "(...)" notes and everything after a comma dropped, l'/d' elisions split, other
    punctuation removed, spaces collapsed."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("œ", "oe").replace("æ", "ae")
    text = text.translate(_CHAR_MAP)
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch) and ch != "ـ")
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.split(r"[,;]", text)[0]
    text = text.replace("’", "'").replace("d'", "d ").replace("l'", "l ")
    text = re.sub(rf"[^a-z0-9' \-{_ARABIC_LETTERS}]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if re.search(rf"[{_ARABIC_LETTERS}]", text):
        text = " ".join(_strip_article(w) for w in text.split())
    return text


def _has_arabic(text: str) -> bool:
    return re.search(rf"[{_ARABIC_LETTERS}]", text) is not None


_AR_DESCRIPTORS = {normalize_text(w) for w in _AR_DESCRIPTORS}
# Serving/count words that sometimes end up attached to the name ("fromage portions",
# "pieces of cheese", "شرائح جبن"): they are the unit, not part of the product. Kept out of the
# legacy descriptor set so old purchase-mark keys still resolve exactly as before.
_UNIT_WORDS = {normalize_text(w) for w in (
    "portion", "portions", "piece", "pieces", "slice", "slices", "part", "parts", "shredded",
    "tranche", "tranches", "morceau", "morceaux", "piece", "pieces", "rondelle", "rondelles",
    "حصة", "حصص", "قطعة", "قطع", "شريحة", "شرائح",
)}
_ALL_DESCRIPTORS = _DESCRIPTORS | _FR_DESCRIPTORS | _AR_DESCRIPTORS | _UNIT_WORDS
_KEYWORD_AISLES = _KEYWORD_AISLES + [
    (tuple(normalize_text(k) for k in keywords), aisle) for keywords, aisle in _KEYWORD_AISLES_MULTI
]


# ---------- alias tables ----------

# v1: the original English dictionary under the original normalization. Frozen: it feeds the
# legacy lookup (old mark keys) and the first fuzzy pass (typos that already resolved).
_ALIASES_V1: dict[str, str] = {}
for _canonical, (_aisle, _staple, _names) in _DICTIONARY_V1.items():
    _ALIASES_V1.setdefault(_normalize_legacy(_canonical), _canonical)
    for _name in _names:
        _ALIASES_V1.setdefault(_normalize_legacy(_name), _canonical)

_ALIASES: dict[str, str] = {}
_ALIASES_NEW_LATIN: dict[str, str] = {}  # added after v1, Latin script (second fuzzy pass)
_ALIASES_AR: dict[str, str] = {}  # Arabic script (fuzzy matching stays inside the script)


def _register(text: str, canonical: str) -> None:
    key = normalize_text(text)
    if not key or key in _ALIASES:
        return
    _ALIASES[key] = canonical
    if _has_arabic(key):
        _ALIASES_AR[key] = canonical
    elif key not in _ALIASES_V1:
        _ALIASES_NEW_LATIN[key] = canonical


for _canonical, (_aisle, _staple, _names) in _DICTIONARY_V1.items():
    _register(_canonical, _canonical)
    for _name in _names:
        _register(_name, _canonical)
# Added English first (a canonical name outranks another entry's French alias), then French, then Arabic.
for _canonical, (_aisle, _staple, _names) in NEW_ENTRIES.items():
    _register(_canonical, _canonical)
    for _name in _names:
        _register(_name, _canonical)
for _canonical, _names in EXTRA_EN.items():
    for _name in _names:
        _register(_name, _canonical)
for _lang in (0, 1):
    for _canonical, _pair in NAMES.items():
        for _name in _pair[_lang]:
            _register(_name, _canonical)

# Aliases added after grocery marks were first stored under their raw spelling (the chili
# variants). `legacy_canonical_name` ignores them so an old mark key can still be found.
_LATE_ALIAS_TEXTS = {
    _normalize_legacy(t)
    for t in ("green chilli", "green chillies", "red chilli", "red chillies",
              "dried red chillies", "dried red chilies", "red chile flakes", "red chilli flakes")
}
_LEGACY_ALIASES = {k: v for k, v in _ALIASES_V1.items() if k not in _LATE_ALIAS_TEXTS}


def _drop_particles(text: str) -> str:
    return " ".join(w for w in text.split() if w not in _FR_PARTICLES)


# "farine de ble" / "farine ble" / "la farine de ble" share one particle-free key.
_PARTICLE_INDEX: dict[str, str] = {}
for _key, _canonical in _ALIASES.items():
    if _has_arabic(_key):
        continue
    _pkey = _drop_particles(_key)
    if _pkey and _pkey != _key and _pkey not in _ALIASES:
        _PARTICLE_INDEX.setdefault(_pkey, _canonical)


def _singular_forms(text: str) -> list[str]:
    forms = []
    if text.endswith("ies"):
        forms.append(text[:-3] + "y")
    if text.endswith("oes") or re.search(r"(ch|sh|ss|x)es$", text):
        forms.append(text[:-2])
    if text.endswith("s") and not text.endswith("ss"):
        forms.append(text[:-1])
    return forms


def _extra_singular_forms(text: str) -> list[str]:
    """French plurals the English rules miss: eaux -> eau, choux -> chou."""
    if text.endswith("eaux") or text.endswith("ux"):
        return [text[:-1]]
    return []


def _lookup(text: str, legacy: bool = False) -> str | None:
    table = _LEGACY_ALIASES if legacy else _ALIASES
    if text in table:
        return table[text]
    for form in _singular_forms(text):
        if form in table:
            return table[form]
    if not legacy:
        for form in _extra_singular_forms(text):
            if form in table:
                return table[form]
    return None


def _distance(a: str, b: str) -> int:
    """Damerau-Levenshtein (optimal string alignment): a swap of two letters costs 1."""
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[len(b)]


# Fuzzy matching is deliberately conservative (precision over recall): both the typed text
# and the dictionary spelling must be at least this long, so short look-alikes
# (pear/peas, lime/lemon, oil/foil) can never merge. Arabic words are short (3-4 letters),
# so one edit already changes the word: Arabic needs 6+ letters (mostly multi-word names).
_FUZZY_MIN_LEN = 5
_FUZZY_MIN_LEN_AR = 6


def _fuzzy_limit(length: int) -> int:
    # One edit only: two edits already merge real different foods ("beef steak"/"beef stock",
    # "coconut oil"/"coconut milk").
    return 1


def _fuzzy_over(text: str, table: dict[str, str], min_len: int) -> str | None:
    limit = _fuzzy_limit(len(text))
    best = limit + 1
    winners: set[str] = set()
    for alias, canonical in table.items():
        if len(alias) < min_len or alias[0] != text[0] or abs(len(alias) - len(text)) > limit:
            continue
        d = _distance(text, alias)
        if d > limit:
            continue
        if d < best:
            best, winners = d, {canonical}
        elif d == best:
            winners.add(canonical)
    return next(iter(winners)) if len(winners) == 1 else None


@lru_cache(maxsize=4096)
def fuzzy_match(text: str) -> str | None:
    """The canonical name for a near-miss spelling ("buttter", "tomatoe", "chiken breast"),
    or None. Needs the same first letter, one edit, and exactly one canonical name at the
    best distance (a tie means ambiguous, so no match). It never crosses scripts: Arabic text
    is only compared with Arabic names (6+ letters), Latin text with Latin names; Latin text is
    compared with the original English dictionary first, so a typo that already resolved keeps
    its meaning, and only then with the later (mostly French) names."""
    if not text or not text[0].isalpha():
        return None
    if _has_arabic(text):
        if len(text) < _FUZZY_MIN_LEN_AR:
            return None
        return _fuzzy_over(text, _ALIASES_AR, _FUZZY_MIN_LEN_AR)
    if len(text) < _FUZZY_MIN_LEN:
        return None
    return _fuzzy_over(text, _ALIASES_V1, _FUZZY_MIN_LEN) or _fuzzy_over(text, _ALIASES_NEW_LATIN, _FUZZY_MIN_LEN)


def _lookup_fuzzy(text: str) -> str | None:
    for form in [text, *_singular_forms(text)]:
        found = fuzzy_match(form)
        if found:
            return found
    return None


def suggest(name: str) -> str | None:
    """A "did you mean" canonical name when `name` is a near-miss, not an exact match."""
    text = normalize_text(name)
    if not text or _match(text, fuzzy=False):
        return None
    return _match(text)


def _match(text: str, fuzzy: bool = True, legacy: bool = False) -> str | None:
    """Exact/alias/plural lookup, then with descriptors stripped, then (not legacy) with French
    articles/particles dropped; fuzzy only as a last resort (never in legacy mode), so a name
    any earlier step resolves can never be re-routed. Legacy mode is the original English-only
    behavior, frozen, for finding old purchase-mark keys."""
    found = _lookup(text, legacy)
    if found:
        return found
    descriptors = _DESCRIPTORS if legacy else _ALL_DESCRIPTORS
    stripped = " ".join(w for w in text.split() if w not in descriptors and not w.isdigit())
    if stripped and stripped != text:
        found = _lookup(stripped, legacy)
        if found:
            return found
    if legacy:
        return None
    for candidate in dict.fromkeys(c for c in (text, stripped) if c):
        particle_free = _drop_particles(candidate)
        if particle_free:
            found = _lookup(particle_free) or _PARTICLE_INDEX.get(particle_free)
            if found:
                return found
    if fuzzy:
        # First exactly as before (English descriptors only), then with the French/Arabic ones.
        english_only = " ".join(w for w in text.split() if w not in _DESCRIPTORS and not w.isdigit())
        return _lookup_fuzzy(english_only or text) or (
            _lookup_fuzzy(stripped or text) if stripped != english_only else None
        )
    return None


_ALTERNATIVES = re.compile(r"\s(?:or|ou|او)\s")


def _unknown_name(alternative: str, legacy: bool) -> str:
    descriptors = _DESCRIPTORS if legacy else _ALL_DESCRIPTORS
    words = [w for w in alternative.split() if w not in descriptors and not w.isdigit()]
    if not legacy:
        while words and words[0] in _FR_PARTICLES:
            words.pop(0)
    return " ".join(words)


def _canonical(name: str, legacy: bool) -> str:
    text = _normalize_legacy(name) if legacy else normalize_text(name)
    if not text:
        return ""
    found = _match(text, legacy=legacy)
    if found:
        return found
    if legacy:
        alternatives = [a.strip() for a in text.split(" or ")] if " or " in text else [text]
    else:
        alternatives = [a.strip() for a in _ALTERNATIVES.split(f" {text} ")] if _ALTERNATIVES.search(f" {text} ") else [text]
    if len(alternatives) > 1:
        first, last = alternatives[0].split(), alternatives[-1].split()
        bare_first = None
        if len(first) == 1 and len(last) > 1:
            # "coconut or cane vinegar" -> "coconut vinegar"
            alternatives.insert(0, " ".join(first + last[1:]))
            bare_first = alternatives[1]
        for alternative in alternatives:
            found = _match(alternative, legacy=legacy)
            if found and alternative == bare_first and found not in _DICTIONARY_V1:
                continue  # a later entry must not hijack "coconut or cane vinegar" as "coconut"
            if found:
                return found
    # Unknown: first alternative that still has words once descriptors are removed.
    for alternative in alternatives:
        stripped = _unknown_name(alternative, legacy)
        if stripped:
            return stripped
    return text


@lru_cache(maxsize=4096)
def canonical_name(name: str) -> str:
    """The merge name for an ingredient, always the English canonical name when a dictionary
    entry matches (in any of English, French, Arabic; also trying each side of "X or Y", first
    match wins), else the normalized text with size/prep descriptors removed."""
    return _canonical(name, legacy=False)


@lru_cache(maxsize=4096)
def legacy_canonical_name(name: str) -> str:
    """The merge name before fuzzy matching, the chili aliases and the French/Arabic names
    existed. Only used to find purchase marks stored under the old key (see
    groceries.build_list). Empty for names that were unreadable then (Arabic script)."""
    return _canonical(name, legacy=True)


def is_known(name: str) -> bool:
    """True when the dictionary recognizes the name (any language, typos tolerated)."""
    return canonical_name(name) in _DICTIONARY


def aisle_info(name: str) -> tuple[str, bool]:
    """(aisle, known). Known names take the dictionary's aisle; unknown ones get a keyword
    guess (or "other")."""
    canonical = canonical_name(name)
    entry = _DICTIONARY.get(canonical)
    if entry:
        return entry[0], True
    words = set(canonical.split())
    for keywords, aisle in _KEYWORD_AISLES:
        for keyword in keywords:
            if (" " in keyword and keyword in canonical) or keyword in words or any(
                w.startswith(keyword) for w in words
            ):
                return aisle, False
    return "other", False


def aisle_for(name: str) -> str:
    return aisle_info(name)[0]


def is_default_staple(name: str) -> bool:
    entry = _DICTIONARY.get(canonical_name(name))
    return bool(entry and entry[1])
