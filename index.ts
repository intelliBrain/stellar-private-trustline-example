require('dotenv').config({})
import * as StellarSdk from 'stellar-sdk'
import { initIssuer, getIssuerKey, getDistributorKey } from './issuer'
import { createWalllet, getWalletKey } from './wallet'

interface AddOperationDelegate {
  (txBuilder: StellarSdk.TransactionBuilder): void;
}

StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Server('https://horizon-testnet.stellar.org')

async function run() {
  const [issuer, distributor] = await initIssuer(server);
  const wallet = await createWalllet(server);
  
  if (!wallet) {
    throw new Error('[main] wallet is unavaliable => abort');
  }

  const issuerKey = await getIssuerKey();
  const distributorKey = await getDistributorKey();
  const walletKey = await getWalletKey();

  console.log(`[main] issuer.....:        id = ${issuer.id}`);
  console.log(`[main] issuer.....: publicKey = ${issuerKey.publicKey()}`);
  console.log('');
  console.log(`[main] distributor:        id = ${distributor.id}`);
  console.log(`[main] distributor: publicKey = ${distributorKey.publicKey()}`);
  console.log('');
  console.log(`[main] wallet.....:        id = ${wallet.id}`);
  console.log(`[main] wallet.....: publicKey = ${walletKey.publicKey()}`);
  console.log('');

  const { ASSET_NAME } = process.env
  if (ASSET_NAME) {
    const AppAsset = new StellarSdk.Asset(ASSET_NAME, issuerKey.publicKey())

    //********************************************************
    // Lock our asset by setting an option
    // AUTHORIZATION REQUIRED flag
    // to issuer account
    //********************************************************
    createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: setOptions(setFlags=AuthRequiredFlag)`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.setOptions({
            setFlags: StellarSdk.AuthRequiredFlag
            // clearFlags: StellarSdk.AuthRequiredFlag
          })
        );
      }
    );


    //********************************************************
    // Change distributor trustline to trust
    // issuer
    //********************************************************
    createSignAndSubmitTransaction(
      distributor, 
      distributorKey, 
      `[main] distributor: changeTrust(asset=AppAsset)`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.changeTrust({
            asset: AppAsset
          })
        );
      }
    );


    //********************************************************
    // Allow distributor to hold
    // our custom asset
    //********************************************************
    createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: allowTrust (assetCode='${ASSET_NAME}', authorize=true, trustor=${distributor.id})`,
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.allowTrust({
            assetCode: ASSET_NAME,
            authorize: true,
            trustor: distributor.id
          })
        );
      }
    );


    //********************************************************
    // Issuing Asset to distributor
    //********************************************************
    createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: payment(asset=AppAsset, amount=300, destination=${distributorKey.publicKey()})`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.payment({
            asset: AppAsset,
            amount: '300',
            destination: distributor.id
          })
        );
      }
    );

    console.log(`[main] distributor ${distributorKey.publicKey()} asset balances:`)
    distributor.balances.forEach((asset) => {
      console.log(asset)
    })

    distributor.balances.forEach((asset) => {
      console.log(asset)
    })


    //********************************************************
    // Customer init wallet and account
    // and then try to add trustline without
    // authorization
    //********************************************************
    // const wallet = await createWalllet(server)
    // if (!wallet) {
    //   throw new Error('[main] wallet is unavaliable => abort')
    // }

    
    //const walletKey = await getWalletKey()
    //console.log(`[main] wallet.id=${wallet.id}, publicKey=${walletKey.publicKey()}`);


    //********************************************************
    // customer account add trustline without authorization
    //********************************************************
    createSignAndSubmitTransaction(
      wallet, 
      walletKey, 
      `[main] wallet: changeTrust(asset=AppAsset)`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.changeTrust({
            asset: AppAsset
          })
        );
      }
    );


    //********************************************************
    // Try to send asset to customer
    // Distributor will fail at the first attempt to send
    // some asset to wallet
    //********************************************************
    createSignAndSubmitTransaction(
      distributor, 
      distributorKey, 
      `[main] distributor: payment(asset=AppAsset, amount='20', destination=${walletKey.publicKey()})`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.payment({
            asset: AppAsset,
            amount: '20',
            destination: wallet.id
          })
        );
      }
    );


    //********************************************************
    // To allow wallet to hold our asset
    // issuer should
    // AllowTrust for customer wallet key
    //********************************************************
    createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: allowTrust(assetCode='${AppAsset.code}', authorize=true, trustor='${wallet.id}')`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.allowTrust({
            assetCode: AppAsset.code,
            authorize: true,
            trustor: wallet.id
          })
        );
      }
    );


    //********************************************************
    // and then ask distributor to
    // try to send Asset to wallet again
    //********************************************************
    createSignAndSubmitTransaction(
      distributor, 
      distributorKey, 
      `[main] distributor: payment(asset='AppAsset', amount='20', destination='${wallet.id}')`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.payment({
            asset: AppAsset,
            amount: '20',
            destination: wallet.id
          })
        );
      }
    );
  } else {
    console.log('[main] Asset name not found (process.env.ASSET_NAME)')
  }
}

const createSignAndSubmitTransaction = async (sourceAccount: StellarSdk.Account, signerKey: StellarSdk.Keypair, title: string, addOperationDelegate: AddOperationDelegate) => {
  const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
  fee: "100",
  networkPassphrase: StellarSdk.Networks.TESTNET
  });

  addOperationDelegate(txBuilder);

  txBuilder.setTimeout(100);
  const transaction = txBuilder.build();

  // sign transaction
  transaction.sign(signerKey);

  // submit to server
  console.log(title);
  
  try {
    await server.submitTransaction(transaction);
  } catch (e) {
    console.log(`${title}: Exception occured for signer: ${signerKey.publicKey()}`);
    console.dir(e)
  }
};

run();
