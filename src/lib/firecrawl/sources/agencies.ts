import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

export interface AgencyConfig {
  name: string;
  website: string;
  searchPattern: string;
  suburbs: string[];
  enabled: boolean;
}

/**
 * Casey, Cardinia & Baw Baw real estate agencies — 43 agencies.
 * Corporate website URLs confirmed via research.
 */
export const CASEY_CARDINIA_AGENCIES: AgencyConfig[] = [
  // ─── CITY OF CASEY ───
  { name: "O'Brien Real Estate Berwick", website: 'https://obrienrealestate.com.au', searchPattern: 'https://obrienrealestate.com.au/property?search={query}', suburbs: ['Berwick', 'Beaconsfield', 'Narre Warren', 'Pakenham'], enabled: true },
  { name: 'Ray White Berwick', website: 'https://raywhiteberwick.com.au', searchPattern: 'https://raywhiteberwick.com.au/properties?search={query}', suburbs: ['Berwick', 'Beaconsfield'], enabled: true },
  { name: 'Ray White Narre Warren', website: 'https://raywhitenarrewarren.com.au', searchPattern: 'https://raywhitenarrewarren.com.au/properties?search={query}', suburbs: ['Narre Warren', 'Narre Warren South'], enabled: true },
  { name: 'Ray White Cranbourne', website: 'https://raywhitecranbourne.com', searchPattern: 'https://raywhitecranbourne.com/properties?search={query}', suburbs: ['Cranbourne', 'Cranbourne East', 'Cranbourne North'], enabled: true },
  { name: 'Harcourts Berwick', website: 'https://harcourts.net/au/office/berwick', searchPattern: 'https://harcourts.net/au/office/berwick?search={query}', suburbs: ['Berwick', 'Beaconsfield', 'Narre Warren'], enabled: true },
  { name: 'Barry Plant Berwick', website: 'https://barryplant.com.au/offices/berwick/', searchPattern: 'https://barryplant.com.au/offices/berwick/?search={query}', suburbs: ['Berwick', 'Beaconsfield', 'Harkaway'], enabled: true },
  { name: 'Belle Property Berwick', website: 'https://belleproperty.com/berwick', searchPattern: 'https://belleproperty.com/berwick?search={query}', suburbs: ['Berwick', 'Beaconsfield'], enabled: true },
  { name: 'Peake Real Estate', website: 'https://peakere.com.au', searchPattern: 'https://peakere.com.au/listings?search={query}', suburbs: ['Berwick', 'Officer', 'Pakenham', 'Beaconsfield'], enabled: true },
  { name: 'JR Property Real Estate', website: 'https://jrprop.com.au', searchPattern: 'https://jrprop.com.au/listings?search={query}', suburbs: ['Berwick', 'Beaconsfield'], enabled: true },
  { name: 'Elite Agents & Partners', website: 'https://eliteagents.net.au', searchPattern: 'https://eliteagents.net.au/listings?search={query}', suburbs: ['Berwick', 'Guys Hill', 'Narre Warren'], enabled: true },
  { name: 'Grants Estate Agents', website: 'https://grantsea.com.au', searchPattern: 'https://grantsea.com.au/listings/?search={query}', suburbs: ['Narre Warren', 'Berwick', 'Pakenham'], enabled: true },
  { name: 'P&G Real Estate', website: 'https://pgrealestate.au', searchPattern: 'https://pgrealestate.au/listings?search={query}', suburbs: ['Narre Warren', 'Narre Warren South', 'Berwick'], enabled: true },
  { name: 'Kaye Charles Real Estate', website: 'https://kayecharles.com.au', searchPattern: 'https://kayecharles.com.au/listings?search={query}', suburbs: ['Beaconsfield', 'Berwick', 'Officer'], enabled: true },
  { name: 'Fletchers Casey', website: 'https://fletchers.net.au/casey', searchPattern: 'https://fletchers.net.au/search?q={query}', suburbs: ['Cranbourne', 'Clyde', 'Narre Warren'], enabled: true },
  { name: 'YPA Estate Agents Cranbourne', website: 'https://ypa.com.au', searchPattern: 'https://ypa.com.au/search?q={query}', suburbs: ['Cranbourne', 'Clyde', 'Pakenham', 'Narre Warren', 'Berwick'], enabled: true },
  { name: 'Raine & Horne Cranbourne', website: 'https://raineandhorne.com.au/cranbourne', searchPattern: 'https://raineandhorne.com.au/search?q={query}', suburbs: ['Cranbourne', 'Cranbourne East', 'Clyde'], enabled: true },
  { name: 'Raine & Horne Berwick', website: 'https://raineandhorne.com.au/berwick', searchPattern: 'https://raineandhorne.com.au/search?q={query}', suburbs: ['Berwick', 'Beaconsfield'], enabled: true },
  { name: 'Only Estate Agents', website: 'https://onlyestateagents.com.au', searchPattern: 'https://onlyestateagents.com.au/search?q={query}', suburbs: ['Narre Warren', 'Cranbourne', 'Berwick'], enabled: true },
  { name: 'First National Neilson Partners', website: 'https://neilsonpartners.com.au', searchPattern: 'https://neilsonpartners.com.au/listings?search={query}', suburbs: ['Narre Warren', 'Berwick', 'Pakenham', 'Officer'], enabled: true },
  { name: 'LJ Hooker Casey', website: 'https://casey.ljhooker.com.au', searchPattern: 'https://casey.ljhooker.com.au/search?q={query}', suburbs: ['Cranbourne', 'Narre Warren', 'Berwick'], enabled: true },
  { name: 'LJ Hooker Narre Warren', website: 'https://narrewarren.ljhooker.com.au', searchPattern: 'https://narrewarren.ljhooker.com.au/search?q={query}', suburbs: ['Narre Warren', 'Narre Warren South'], enabled: true },
  { name: 'Eview Group South East', website: 'https://eview.com.au', searchPattern: 'https://eview.com.au/search?q={query}', suburbs: ['Beaconsfield', 'Berwick', 'Endeavour Hills', 'Hallam', 'Hampton Park', 'Narre Warren'], enabled: true },
  { name: 'Stockdale & Leggo Narre Warren', website: 'https://stockdaleleggo.com.au', searchPattern: 'https://stockdaleleggo.com.au/search?q={query}', suburbs: ['Narre Warren', 'Cranbourne'], enabled: true },
  { name: 'Just Real Estate', website: 'https://justrealestate.com.au', searchPattern: 'https://justrealestate.com.au/search?q={query}', suburbs: ['Narre Warren', 'Berwick', 'Beaconsfield', 'Cranbourne', 'Pakenham'], enabled: true },
  { name: 'Area Specialist Casey', website: 'https://areaspecialistcasey.com.au', searchPattern: 'https://areaspecialistcasey.com.au/search?query={query}', suburbs: ['Narre Warren', 'Berwick', 'Cranbourne', 'Clyde'], enabled: true },
  { name: 'Coronis', website: 'https://coronis.com.au', searchPattern: 'https://coronis.com.au/search?q={query}', suburbs: ['Berwick'], enabled: true },

  // ─── CARDINIA SHIRE ───
  { name: 'K R Peters Real Estate', website: 'https://krpetersofficer.com.au', searchPattern: 'https://krpetersofficer.com.au/listings?search={query}', suburbs: ['Officer', 'Pakenham'], enabled: true },
  { name: 'LJ Hooker Pakenham', website: 'https://pakenham.ljhooker.com.au', searchPattern: 'https://pakenham.ljhooker.com.au/search?q={query}', suburbs: ['Pakenham', 'Officer', 'Nar Nar Goon', 'Tynong', 'Garfield', 'Bunyip'], enabled: true },
  { name: 'Uphill Real Estate', website: 'https://uphillofficer.com.au', searchPattern: 'https://uphillofficer.com.au/listings?search={query}', suburbs: ['Officer', 'Pakenham'], enabled: true },
  { name: 'Harcourts Pakenham', website: 'https://harcourts.net/au/office/pakenham', searchPattern: 'https://harcourts.net/au/office/pakenham?search={query}', suburbs: ['Pakenham', 'Officer'], enabled: true },
  { name: 'Ray White Pakenham', website: 'https://raywhitepakenham.com.au', searchPattern: 'https://raywhitepakenham.com.au/properties?search={query}', suburbs: ['Pakenham', 'Officer'], enabled: true },
  { name: 'Ray White Officer', website: 'https://raywhiteofficer.com', searchPattern: 'https://raywhiteofficer.com/properties?search={query}', suburbs: ['Officer', 'Narre Warren'], enabled: true },
  { name: 'Stockdale & Leggo Pakenham', website: 'https://stockdaleleggo.com.au', searchPattern: 'https://stockdaleleggo.com.au/search?q={query}', suburbs: ['Pakenham', 'Officer'], enabled: true },
  { name: 'Area Specialist Solutions', website: 'https://solutions.areaspecialist.com.au', searchPattern: 'https://solutions.areaspecialist.com.au/search?query={query}', suburbs: ['Officer', 'Pakenham', 'Clyde North'], enabled: true },
  { name: 'AMS Real Estate', website: 'https://amsre.com.au', searchPattern: 'https://amsre.com.au/listings?search={query}', suburbs: ['Officer', 'Clyde North', 'Pakenham'], enabled: true },
  { name: 'Barry Plant Pakenham', website: 'https://barryplant.com.au/offices/pakenham/', searchPattern: 'https://barryplant.com.au/offices/pakenham/?search={query}', suburbs: ['Pakenham', 'Officer', 'Nar Nar Goon'], enabled: true },

  // ─── BAW BAW / WEST GIPPSLAND ───
  { name: 'One Agency Durrand & Co', website: 'https://durrandco.com.au', searchPattern: 'https://durrandco.com.au/listings?search={query}', suburbs: ['Warragul', 'Drouin', 'Yarragon', 'Trafalgar'], enabled: true },
  { name: 'Boyde & Co Real Estate', website: 'https://boyde.co', searchPattern: 'https://boyde.co/listings?search={query}', suburbs: ['Warragul', 'Drouin'], enabled: true },
  { name: 'Barry Plant Warragul-Drouin', website: 'https://barryplant.com.au/offices/warragul-drouin/', searchPattern: 'https://barryplant.com.au/offices/warragul-drouin/?search={query}', suburbs: ['Warragul', 'Drouin'], enabled: true },
  { name: 'Hockingstuart Warragul', website: 'https://hockingstuart.com.au/warragul', searchPattern: 'https://hockingstuart.com.au/search?q={query}', suburbs: ['Warragul', 'Drouin'], enabled: true },
  { name: "O'Brien Real Estate Clark", website: 'https://obrienrealestate.com.au', searchPattern: 'https://obrienrealestate.com.au/property?search={query}', suburbs: ['Warragul', 'Drouin'], enabled: true },
  { name: 'JB Lee Estate Agents', website: 'https://jblee.com.au', searchPattern: 'https://jblee.com.au/listings?search={query}', suburbs: ['Warragul', 'Drouin'], enabled: true },
  { name: 'Harcourts Warragul', website: 'https://harcourts.net/au/office/warragul', searchPattern: 'https://harcourts.net/au/office/warragul?search={query}', suburbs: ['Warragul', 'Moe'], enabled: true },
  { name: 'One Agency Country to Coast', website: 'https://oneagencycountrytocoast.com.au', searchPattern: 'https://oneagencycountrytocoast.com.au/listings?search={query}', suburbs: ['Warragul', 'Drouin', 'Korumburra'], enabled: true },
];

/**
 * Build SourceConfig objects for agencies relevant to a given suburb.
 */
export function getAgencySourcesForSuburb(suburb: string): SourceConfig[] {
  const suburbLower = suburb.toLowerCase();
  return CASEY_CARDINIA_AGENCIES
    .filter((a) => a.enabled && a.suburbs.some((s) => s.toLowerCase() === suburbLower))
    .map(agencyToSourceConfig);
}

/**
 * Get all enabled agency source configs.
 */
export function getAllAgencySources(): SourceConfig[] {
  return CASEY_CARDINIA_AGENCIES.filter((a) => a.enabled).map(agencyToSourceConfig);
}

function agencyToSourceConfig(agency: AgencyConfig): SourceConfig {
  return {
    name: agency.name,
    enabled: agency.enabled,
    buildPropertyUrl: (address: StructuredAddress) => {
      const query = [address.streetNumber, address.streetName, address.streetType, address.suburb]
        .filter(Boolean).join(' ');
      return agency.searchPattern.replace('{query}', encodeURIComponent(query));
    },
    buildSearchUrl: (address: StructuredAddress) => {
      return agency.searchPattern.replace('{query}', encodeURIComponent(address.suburb || ''));
    },
    scrapeOptions: { timeout: 15000, formats: ['markdown'] },
    baseUrl: agency.website,
    trustRank: 4,
    refreshIntervalHours: 12,
  };
}
