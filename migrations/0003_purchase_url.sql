-- Where to buy a trick (dealer or product page). Private, like price.
ALTER TABLE tricks ADD COLUMN purchase_url TEXT NOT NULL DEFAULT '';
