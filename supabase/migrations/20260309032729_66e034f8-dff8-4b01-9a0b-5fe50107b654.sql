ALTER TABLE public.property_availability 
ADD CONSTRAINT property_availability_property_date_unique 
UNIQUE (property_id, date);