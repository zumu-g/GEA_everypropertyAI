// Shared suburb-slug helpers for the ingest scripts.
export const titleCase = (s) => s ? String(s).trim().split(/\s+/).map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'').join(' ') : null;

/** 'narre-warren-south-vic-3805' → 'Narre Warren South' (the DB suburb value). */
export const slugToSuburb = (slug) => titleCase(slug.split('-').slice(0, -2).join(' '));
