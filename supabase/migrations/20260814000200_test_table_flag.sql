-- Test-only tables: their orders/bills must never count toward sales, reports,
-- dashboard, live, or member activity. Flag propagates table → order → bill.
alter table restaurant_tables add column if not exists is_test boolean not null default false;
alter table orders            add column if not exists is_test boolean not null default false;
alter table bills             add column if not exists is_test boolean not null default false;

-- Mark the existing TEST table and back-fill any orders/bills already made on it.
update restaurant_tables set is_test = true where code = 'TEST';
update orders set is_test = true
  where table_id in (select id from restaurant_tables where is_test);
update bills set is_test = true
  where order_id in (select id from orders where is_test);
