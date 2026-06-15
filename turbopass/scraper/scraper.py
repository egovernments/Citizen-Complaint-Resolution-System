import os
import json
import time
import requests

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")

def run_query(query, retries=1000):
    headers = {'User-Agent': 'egov-scraper/1.0'}
    for i in range(retries):
        try:
            print(f"Running query (attempt {i+1}/{retries})...")
            response = requests.post(OVERPASS_URL, data={'data': query}, headers=headers, timeout=300)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                print("Rate limited by Overpass API, sleeping for 60s...")
                time.sleep(60)
            else:
                print(f"Error {response.status_code}: {response.text}")
                time.sleep(60)
        except Exception as e:
            print(f"Request exception: {e}. Waiting for local API to boot...")
            time.sleep(60)
    print("Failed to run query after retries.")
    return None

def get_africa_countries():
    print("Fetching African countries...")
    # Using explicit ISO codes is more reliable than OSM's continent relations
    africa_isos = [
        "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CD", "CG", "DJ", 
        "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "CI", "KE", "LS", "LR", 
        "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", 
        "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW"
    ]
    
    countries = []
    # We will fetch their basic info by querying them one by one or in a batch.
    # To save API calls, we return a list of stub objects. The `get_states` and `get_cities_in_area`
    # will fail gracefully if the area ID is incorrect, but we should fetch their Relation IDs first.
    
    query = """
    [out:json];
    (""" + "".join([f'relation["ISO3166-1"="{iso}"]["admin_level"="2"]["boundary"="administrative"];' for iso in africa_isos]) + """);
    out tags;
    """
    res = run_query(query)
    
    if res and 'elements' in res:
        for el in res['elements']:
            tags = el.get('tags', {})
            name = tags.get('name:en') or tags.get('name')
            iso = tags.get('ISO3166-1', '')
            if name and iso:
                countries.append({
                    'id': el['id'],
                    'name': name.replace('/', '-'),
                    'iso': iso,
                    'continent': 'Africa',
                    'continent_code': 'AF'
                })
    return countries

def get_country_by_iso(iso, continent, continent_code):
    print(f"Fetching country {iso}...")
    query = f"""
    [out:json];
    relation["ISO3166-1"="{iso}"]["admin_level"="2"]["boundary"="administrative"];
    out tags;
    """
    res = run_query(query)
    if res and 'elements' in res and len(res['elements']) > 0:
        el = res['elements'][0]
        tags = el.get('tags', {})
        name = tags.get('name:en') or tags.get('name')
        return {
            'id': el['id'],
            'name': name.replace('/', '-'),
            'iso': iso,
            'continent': continent,
            'continent_code': continent_code
        }
    return None

def get_states(country_id):
    area_id = country_id + 3600000000
    query = f"""
    [out:json];
    area({area_id})->.c;
    relation(area.c)["admin_level"~"4|3"]["boundary"="administrative"];
    out tags;
    """
    res = run_query(query)
    states = []
    if res and 'elements' in res:
        for el in res['elements']:
            tags = el.get('tags', {})
            name = tags.get('name:en') or tags.get('name')
            if name:
                states.append({
                    'id': el['id'],
                    'name': name.replace('/', '-'),
                    'iso': tags.get('ISO3166-2', f"ST-{el['id']}")
                })
    return states

def get_cities_in_area(area_id):
    query = f"""
    [out:json][timeout:300];
    area({area_id})->.a;
    (
      node(area.a)["place"~"city|town"];
    );
    out tags;
    """
    res = run_query(query)
    cities = []
    if res and 'elements' in res:
        for el in res['elements']:
            tags = el.get('tags', {})
            name = tags.get('name:en') or tags.get('name')
            if name:
                cities.append({
                    'id': el['id'],
                    'name': name,
                    'population': tags.get('population'),
                    'place_type': tags.get('place')
                })
    return cities

def main():
    base_dir = "data"
    os.makedirs(base_dir, exist_ok=True)
    
    countries_to_process = get_africa_countries()
    india = get_country_by_iso("IN", "Asia", "AS")
    if india:
        countries_to_process.append(india)
    
    print(f"Total countries to process: {len(countries_to_process)}")
    
    for country in countries_to_process:
        print(f"\\nProcessing {country['name']} ({country['iso']})...")
        country_dir = os.path.join(base_dir, country['continent'], country['name'])
        os.makedirs(country_dir, exist_ok=True)
        
        country_data = {
            'code': country['iso'],
            'name': country['name'],
            'continent': country['continent'],
            'type': 'country',
            'children': []
        }
        
        output_file = os.path.join(country_dir, 'hierarchy.json')
        if os.path.exists(output_file):
            try:
                with open(output_file, 'r', encoding='utf-8') as f:
                    json.load(f)
                print(f"Skipping {country['name']}, valid data already exists.")
                continue
            except Exception:
                print(f"Data for {country['name']} is incomplete or corrupted, re-fetching...")
            
        states = get_states(country['id'])
        if states:
            print(f"Found {len(states)} states/regions in {country['name']}.")
            for state in states:
                print(f"  Fetching cities for state: {state['name']}")
                state_area_id = state['id'] + 3600000000
                cities = get_cities_in_area(state_area_id)
                
                state_node = {
                    'code': state['iso'],
                    'parent_code': country['iso'],
                    'name': state['name'],
                    'type': 'state',
                    'children': []
                }
                
                for city in cities:
                    city_node = {
                        'code': f"CTY-{city['id']}",
                        'parent_code': state['iso'],
                        'name': city['name'],
                        'type': 'city',
                        'population': city['population'],
                        'place_type': city['place_type']
                    }
                    state_node['children'].append(city_node)
                
                country_data['children'].append(state_node)
                time.sleep(1) # Be nice to API
        else:
            print(f"No states found for {country['name']}, fetching cities directly...")
            country_area_id = country['id'] + 3600000000
            cities = get_cities_in_area(country_area_id)
            for city in cities:
                city_node = {
                    'code': f"CTY-{city['id']}",
                    'parent_code': country['iso'],
                    'name': city['name'],
                    'type': 'city',
                    'population': city['population'],
                    'place_type': city['place_type']
                }
                country_data['children'].append(city_node)
            time.sleep(1)
            
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(country_data, f, indent=2, ensure_ascii=False)
        print(f"Saved {country['name']} data.")

if __name__ == "__main__":
    main()
