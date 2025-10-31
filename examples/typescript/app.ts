/**
 * Example TypeScript Application for FlowTrace Testing
 * Product catalog service with type-safe operations
 */

// Type definitions
interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
}

interface ProductFilter {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
}

interface ProductCreateData {
  name: string;
  price: number;
  category: string;
  inStock?: boolean;
}

// Simulated database
const products: Product[] = [
  { id: 1, name: 'Laptop', price: 999.99, category: 'Electronics', inStock: true },
  { id: 2, name: 'Mouse', price: 29.99, category: 'Electronics', inStock: true },
  { id: 3, name: 'Desk', price: 299.99, category: 'Furniture', inStock: false },
  { id: 4, name: 'Chair', price: 199.99, category: 'Furniture', inStock: true }
];

/**
 * Product Catalog Service
 */
export class ProductCatalog {
  private lastId: number;
  private cache: Map<number, Product>;

  constructor() {
    this.lastId = products.length;
    this.cache = new Map<number, Product>();
  }

  /**
   * Get all products
   */
  getAllProducts(): Product[] {
    console.log('Fetching all products');
    return [...products];
  }

  /**
   * Get product by ID
   */
  getProductById(id: number): Product {
    console.log(`Looking up product with ID: ${id}`);

    // Check cache
    if (this.cache.has(id)) {
      console.log('Cache hit!');
      return this.cache.get(id)!;
    }

    const product = products.find(p => p.id === id);

    if (!product) {
      throw new Error(`Product not found: ${id}`);
    }

    // Cache the result
    this.cache.set(id, product);

    return product;
  }

  /**
   * Filter products
   */
  filterProducts(filter: ProductFilter): Product[] {
    console.log('Filtering products:', filter);

    let result = [...products];

    if (filter.category) {
      result = result.filter(p => p.category === filter.category);
    }

    if (filter.minPrice !== undefined) {
      result = result.filter(p => p.price >= filter.minPrice!);
    }

    if (filter.maxPrice !== undefined) {
      result = result.filter(p => p.price <= filter.maxPrice!);
    }

    if (filter.inStock !== undefined) {
      result = result.filter(p => p.inStock === filter.inStock);
    }

    return result;
  }

  /**
   * Create new product (async)
   */
  async createProduct(productData: ProductCreateData): Promise<Product> {
    console.log('Creating new product:', productData);

    // Validate
    this.validateProduct(productData);

    // Simulate async database insert
    await this.delay(100);

    const newProduct: Product = {
      id: ++this.lastId,
      inStock: true,
      ...productData
    };

    products.push(newProduct);

    return newProduct;
  }

  /**
   * Update product price (async)
   */
  async updateProductPrice(id: number, newPrice: number): Promise<Product> {
    console.log(`Updating product ${id} price to: ${newPrice}`);

    if (newPrice <= 0) {
      throw new Error('Price must be positive');
    }

    const product = this.getProductById(id);

    // Simulate async operation
    await this.delay(50);

    product.price = newPrice;

    // Invalidate cache
    this.cache.delete(id);

    return product;
  }

  /**
   * Update stock status (async)
   */
  async updateStockStatus(id: number, inStock: boolean): Promise<Product> {
    console.log(`Updating product ${id} stock status to: ${inStock}`);

    const product = this.getProductById(id);

    // Simulate async operation
    await this.delay(50);

    product.inStock = inStock;

    // Invalidate cache
    this.cache.delete(id);

    return product;
  }

  /**
   * Calculate total inventory value
   */
  calculateInventoryValue(): number {
    console.log('Calculating total inventory value');

    const total = products
      .filter(p => p.inStock)
      .reduce((sum, p) => sum + p.price, 0);

    return Math.round(total * 100) / 100;
  }

  /**
   * Get products by category (async)
   */
  async getProductsByCategory(category: string): Promise<Product[]> {
    console.log(`Fetching products in category: ${category}`);

    // Simulate async database query
    await this.delay(75);

    return this.filterProducts({ category });
  }

  /**
   * Validate product data
   */
  private validateProduct(product: ProductCreateData): void {
    if (!product.name || product.name.trim() === '') {
      throw new Error('Product name is required');
    }

    if (product.price <= 0) {
      throw new Error('Price must be positive');
    }

    if (!product.category || product.category.trim() === '') {
      throw new Error('Category is required');
    }
  }

  /**
   * Utility: Delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    console.log('Clearing cache');
    this.cache.clear();
  }
}

/**
 * Main application logic
 */
async function main(): Promise<void> {
  console.log('Starting FlowTrace Example Application (TypeScript)');
  console.log('='.repeat(60));

  const catalog = new ProductCatalog();

  try {
    // Test 1: Get all products
    console.log('\n--- Test 1: Get All Products ---');
    const allProducts = catalog.getAllProducts();
    console.log('Total products:', allProducts.length);

    // Test 2: Get product by ID
    console.log('\n--- Test 2: Get Product by ID ---');
    const product1 = catalog.getProductById(1);
    console.log('Found product:', product1);

    // Test 3: Cache hit
    console.log('\n--- Test 3: Cache Hit ---');
    const product1Again = catalog.getProductById(1);
    console.log('Found product (cached):', product1Again);

    // Test 4: Filter products
    console.log('\n--- Test 4: Filter Products ---');
    const electronicProducts = catalog.filterProducts({
      category: 'Electronics',
      inStock: true
    });
    console.log('Electronic products in stock:', electronicProducts.length);

    // Test 5: Create new product
    console.log('\n--- Test 5: Create New Product ---');
    const newProduct = await catalog.createProduct({
      name: 'Keyboard',
      price: 79.99,
      category: 'Electronics'
    });
    console.log('Created product:', newProduct);

    // Test 6: Update product price
    console.log('\n--- Test 6: Update Product Price ---');
    const updatedProduct = await catalog.updateProductPrice(1, 899.99);
    console.log('Updated product:', updatedProduct);

    // Test 7: Update stock status
    console.log('\n--- Test 7: Update Stock Status ---');
    const restockedProduct = await catalog.updateStockStatus(3, true);
    console.log('Restocked product:', restockedProduct);

    // Test 8: Calculate inventory value
    console.log('\n--- Test 8: Calculate Inventory Value ---');
    const totalValue = catalog.calculateInventoryValue();
    console.log('Total inventory value:', `$${totalValue}`);

    // Test 9: Get products by category (async)
    console.log('\n--- Test 9: Get Products by Category (Async) ---');
    const furnitureProducts = await catalog.getProductsByCategory('Furniture');
    console.log('Furniture products:', furnitureProducts.length);

    // Test 10: Clear cache
    console.log('\n--- Test 10: Clear Cache ---');
    catalog.clearCache();
    console.log('Cache cleared');

    // Test 11: Error handling - validation
    console.log('\n--- Test 11: Error Handling (Validation) ---');
    try {
      await catalog.createProduct({
        name: '',
        price: -10,
        category: 'Invalid'
      });
    } catch (error) {
      console.log('Caught validation error:', (error as Error).message);
    }

    // Test 12: Error handling - not found
    console.log('\n--- Test 12: Error Handling (Not Found) ---');
    try {
      catalog.getProductById(999);
    } catch (error) {
      console.log('Caught not found error:', (error as Error).message);
    }

    // Test 13: Error handling - invalid price
    console.log('\n--- Test 13: Error Handling (Invalid Price) ---');
    try {
      await catalog.updateProductPrice(1, -100);
    } catch (error) {
      console.log('Caught invalid price error:', (error as Error).message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('All tests completed successfully!');

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export { main };
