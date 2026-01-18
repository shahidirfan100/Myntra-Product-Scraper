# Myntra Product Scraper

Extract comprehensive product data from Myntra's extensive catalog with ease. Collect product details including names, brands, prices, ratings, availability, and images from any category or search page. Perfect for price monitoring, market research, and competitive analysis in the Indian fashion e-commerce market.

## Features

- **Complete Product Data** — Extract all essential details including prices, discounts, ratings, sizes, and availability
- **Automatic Pagination** — Seamlessly navigate through multiple pages to collect your desired number of products
- **Smart Deduplication** — Eliminate duplicate entries automatically for clean, accurate datasets
- **Flexible URL Input** — Start from any Myntra category, search page, or custom URL
- **Structured JSON Output** — Get well-organized data ready for analysis and integration
- **Rate Limit Protection** — Built-in delays and retry mechanisms to ensure reliable data collection

## Use Cases

### Price Monitoring
Track product prices and discounts across Myntra's catalog. Monitor pricing trends, identify seasonal sales patterns, and stay competitive in the fashion e-commerce market.

### Market Research
Analyze product catalogs to identify trending brands, popular categories, and market gaps. Understand customer preferences through ratings and reviews data for better product sourcing decisions.

### Competitive Analysis
Compare pricing strategies, product ranges, and discount patterns across different brands and categories. Make data-driven decisions for inventory planning and pricing optimization.

### Product Intelligence
Build comprehensive product databases for fashion analytics. Track availability, size options, and product attributes across thousands of listings for business intelligence.

### Catalog Management
Keep your product database synchronized with Myntra's catalog. Monitor new product launches, discontinued items, and category changes automatically.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | Array | No | `[{"url": "https://www.myntra.com/men-tshirts"}]` | Category, search, or listing URLs to scrape |
| `results_wanted` | Integer | No | `20` | Maximum number of products to collect |
| `proxyConfiguration` | Object | No | Residential proxy | Proxy settings (residential recommended) |

---

## Output Data

Each product in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | String | Unique product identifier |
| `name` | String | Product name/title |
| `brand` | String | Brand name |
| `price` | Number | Current selling price (₹) |
| `mrp` | Number | Original maximum retail price (₹) |
| `discountPercent` | Number | Discount percentage |
| `rating` | Number | Average customer rating (1-5 scale) |
| `ratingCount` | Number | Total number of ratings |
| `sizes` | Array | Available sizes (e.g., ["S", "M", "L"]) |
| `imageUrl` | String | Product image URL |
| `productUrl` | String | Direct link to product page |
| `inStock` | Boolean | Stock availability status |
| `isSponsored` | Boolean | Whether this is a sponsored/promoted listing |
| `sourceUrl` | String | URL where data was collected |
| `scrapedAt` | String | ISO timestamp of data collection |

---

## Usage Examples

### Basic Category Scraping

Extract products from a specific category:

```json
{
    "startUrls": [
        {"url": "https://www.myntra.com/men-tshirts"}
    ],
    "results_wanted": 50
}
```

### Multiple Categories

Scrape products from multiple categories simultaneously:

```json
{
    "startUrls": [
        {"url": "https://www.myntra.com/men-tshirts"},
        {"url": "https://www.myntra.com/women-dresses"},
        {"url": "https://www.myntra.com/kids-clothing"}
    ],
    "results_wanted": 200
}
```

### Large-Scale Collection

For comprehensive data collection:

```json
{
    "startUrls": [
        {"url": "https://www.myntra.com/casual-shoes"}
    ],
    "results_wanted": 1000
}
```

### Search Results Scraping

Extract products from search results:

```json
{
    "startUrls": [
        {"url": "https://www.myntra.com/nike-shoes"}
    ],
    "results_wanted": 100
}
```

---

## Sample Output

```json
{
    "productId": "12345678",
    "name": "Men Graphic Printed Round Neck Pure Cotton T-shirt",
    "brand": "Roadster",
    "price": 499,
    "mrp": 999,
    "discountPercent": 50,
    "rating": 4.3,
    "ratingCount": 1856,
    "sizes": ["S", "M", "L", "XL", "XXL"],
    "imageUrl": "https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/12345678/2024/1/15/abc123_1.jpg",
    "productUrl": "https://www.myntra.com/tshirts/roadster/roadster-men-graphic-printed-round-neck-pure-cotton-t-shirt/12345678/buy",
    "inStock": true,
    "isSponsored": false,
    "sourceUrl": "https://www.myntra.com/men-tshirts",
    "scrapedAt": "2026-01-18T04:36:57.000Z"
}
```

---

## Tips for Best Results

### Choose Valid URLs
- Use category pages, search results, or brand pages as start URLs
- Verify URLs are accessible before starting the scrape
- Test with a small `maxItems` value first to ensure the URL works

### Optimize Collection Size
- Start with 20-50 items for testing purposes
- Increase to 200-500 for medium-sized collections
- Use 1000+ for comprehensive catalog extraction
- Balance speed with data quantity based on your needs

### Handle Rate Limits
- Use `requestDelaySecs` of 1-2 seconds for reliable scraping
- Increase delay to 2-3 seconds if you encounter errors
- Enable proxies for large-scale collection (`maxItems` > 500)
- Reduce `maxConcurrency` in proxy settings if needed

### Maximize Data Quality
- Filter out-of-stock items during post-processing if needed
- Cross-reference `productId` for accurate deduplication
- Monitor `scrapedAt` timestamps for data freshness
- Check for null values in optional fields like `sizes` or `rating`

### Proxy Configuration

For reliable large-scale scraping, residential proxies are recommended:

```json
{
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Integrations

Connect your Myntra product data with popular business tools:

- **Google Sheets** — Export data for collaborative analysis and reporting
- **Airtable** — Build searchable product databases with custom views
- **Slack** — Receive notifications when scraping completes
- **Webhooks** — Send data to custom endpoints and APIs
- **Make** — Create automated workflows and data pipelines
- **Zapier** — Trigger actions based on product data updates
- **Power BI / Tableau** — Visualize pricing and market trends

### Export Formats

Download your data in multiple formats:

- **JSON** — For developers, APIs, and data processing
- **CSV** — For Excel, Google Sheets, and spreadsheet analysis
- **Excel** — For business reporting and presentations
- **XML** — For system integrations and data interchange

---

## Frequently Asked Questions

### How many products can I scrape?
You can collect all available products from any category or search page. The practical limit depends on Myntra's catalog size and your `maxItems` setting. Most categories have hundreds to thousands of products.

### Does the scraper handle pagination automatically?
Yes, the scraper automatically navigates through multiple pages until it reaches your specified `maxItems` limit or the `maxPages` constraint.

### What if some product fields are missing?
Some fields like `sizes`, `mrp`, or `rating` may be null if Myntra doesn't provide that information for a specific product. This is normal and reflects actual data availability.

### Can I scrape search results?
Yes, you can use any Myntra search result URL as a start URL. The scraper will extract products from search pages just like category pages.

### Do I need proxies?
Proxies are optional but recommended for large-scale scraping (500+ products) to ensure reliability and avoid rate limits. For smaller collections, the default settings work well.

### How long does scraping take?
Scraping time depends on `maxItems`, `requestDelaySecs`, and network conditions. Generally, expect 1-2 seconds per product with default settings. A 100-product scrape typically takes 2-4 minutes.

### What happens if Myntra changes their website?
The scraper is designed to adapt to minor layout changes. If Myntra makes significant changes to their page structure, we'll update the actor to maintain compatibility.

### Can I schedule recurring scrapes?
Yes, use Apify's scheduler to run the scraper at specific intervals (hourly, daily, weekly) for automated price monitoring and catalog updates.

### Is there a limit on concurrent runs?
You can run multiple instances simultaneously. Each run is independent and maintains its own dataset.

### What about product variations and colors?
The scraper extracts product cards as they appear on listing pages. Variations (colors, patterns) typically appear as separate products and will be captured individually.

---

## Support

For issues, feature requests, or technical assistance, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)
- [Proxy Configuration Guide](https://docs.apify.com/proxy)
- [Integration Tutorials](https://docs.apify.com/integrations)

---

## Legal Notice

This actor is designed for legitimate data collection purposes such as market research, price monitoring, and business intelligence. Users are responsible for ensuring compliance with Myntra's terms of service and applicable laws. Use data responsibly, respect rate limits, and avoid excessive requests that may impact website performance.
