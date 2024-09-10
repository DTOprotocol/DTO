// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract DTOEarlyAccess is ReentrancyGuard, Ownable, AccessControl {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    using SafeERC20 for IERC20;

    AggregatorV3Interface internal priceFeed;

    struct Purchase {
        uint256 tokens;
        uint256 ethPriceAtPurchase;
        uint256 timestamp;
        uint256 amountPaid;
    }

    struct CodeInfo {
        address codeOwner;
        uint256 totalEarnings;
    }

    mapping(address => Purchase[]) public purchases;
    mapping(address => uint) public userAllocation;
    mapping(string => CodeInfo) public codes; // Maps code to the code owner and their total earnings

    uint256 public currentRound;
    uint256 public currentPrice; // Price in USDT with 6 decimals

    event TokensPurchased(address indexed buyer, uint256 amount, uint256 price);
    event CodeAdded(string code, address codeOwner);
    event ManagerAdded(address indexed newManager);

    constructor(address _priceFeed, address _manager) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(MANAGER_ROLE, _manager);

        priceFeed = AggregatorV3Interface(_priceFeed);

        currentRound = 0; // Start with round 1
        currentPrice = 5 * 10**4; // $0.05 in USDT terms (USDT has 6 decimals, so 5 * 10^4 = 0.05 USDT)
    }

    // Function to add a code and map it to an address
    function addCode(string memory code, address codeOwner) external onlyRole(MANAGER_ROLE) {
        require(codes[code].codeOwner == address(0), "Code already exists");
        codes[code] = CodeInfo(codeOwner, 0);
        emit CodeAdded(code, codeOwner);
    }

    // Function to buy tokens with ETH using a code
	function buyWithETH(string memory code) external payable nonReentrant {
		require(codes[code].codeOwner != address(0), "Invalid code");

		// Get the latest ETH price in USD (with 18 decimals)
		uint256 ethPrice = getLatestETHPrice();

		// Calculate how much USDT value was sent (USDT has 6 decimals, ETH has 18 decimals)
		uint256 usdtValue = (msg.value * ethPrice) / 1e18;

		// Calculate how many tokens can be purchased based on the USDT value
		// currentPrice is in USDT with 6 decimals, so divide by currentPrice to get token amount
		uint256 tokensToPurchase = usdtValue / currentPrice;

		require(tokensToPurchase > 0, "Not enough ETH to buy tokens");

		// Record purchase for the buyer
		purchases[msg.sender].push(Purchase({
			tokens: tokensToPurchase,
			ethPriceAtPurchase: ethPrice,
			timestamp: block.timestamp,
			amountPaid: msg.value
		}));

		emit TokensPurchased(msg.sender, tokensToPurchase, currentPrice);

		// Update the code's total earnings in CodeInfo
		codes[code].totalEarnings += msg.value;

		// Send 100% of the ETH to the code owner directly
		(bool success, ) = codes[code].codeOwner.call{value: msg.value}("");
		require(success, "Transfer to code owner failed");

		// Increase allocation
		userAllocation[msg.sender] += tokensToPurchase;
	}

    // Function to get the latest ETH/USD price
    function getLatestETHPrice() public view returns (uint256) {
        (
            ,
            int price,
            ,
            ,
        ) = priceFeed.latestRoundData();
        return uint256(price) * 1e10; // Adjust the price to 18 decimal places (ETH uses 18 decimals)
    }

    // Advance to the next round of presale
    function advanceRound(uint256 priceInUSDT) external onlyRole(MANAGER_ROLE) {
        currentPrice = priceInUSDT; // Price should be passed in with 6 decimals (for example, 5e4 = 0.05 USDT)
        currentRound++;
    }

    // Function to add a new manager by the owner
    function addManager(address newManager) external onlyOwner {
        grantRole(MANAGER_ROLE, newManager);
        emit ManagerAdded(newManager);
    }

    // Safe-measure functions
    receive() external payable {}
    fallback() external payable {}

    // Safe-measure to prevent any token lockup
    // Withdraw any token
    function withdrawTokens(address _token) public onlyOwner {
        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(msg.sender, amount);
    }

    // Withdraw Ether
    function withdrawEther() public onlyOwner {
        payable(msg.sender).transfer(address(this).balance);
    }
}
